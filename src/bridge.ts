import { IlinkClient, SessionTimeoutError } from "./ilink/client.js";
import { AuthError, ProtocolError } from "./ilink/errors.js";
import { MessageType, TypingStatus, type WeixinMessage } from "./ilink/types.js";
import { downloadInboundMedia, MediaDownloadError, uploadImage } from "./ilink/media.js";
import { ContextStore } from "./ilink/context-store.js";
import { parseIncomingMessage } from "./message/parser.js";
import { buildImageMessage, buildTextMessage } from "./message/builder.js";
import { chunkText } from "./message/markdown.js";
import { TaskNotifier } from "./message/task-notifier.js";
import { TaskQueue } from "./message/task-queue.js";
import { DocumentConversionError, prepareInboundDocuments } from "./message/documents.js";
import { SlashCommandHandler } from "./command.js";
import { ChatStoppedError, PiSessionManager, type ReplyContext } from "./pi/sessions.js";
import { CONFIG } from "./config.js";
import { logger } from "./logger/index.js";
import { setTimeout as delay } from "node:timers/promises";

/** typing ticket 缓存时长（过期后重新 getconfig 获取） */
const TICKET_TTL_MS = 50 * 60 * 1000;

export class Bridge {
  private getUpdatesBuf = "";
  private consecutiveFailures = 0;
  private slash: SlashCommandHandler;
  private readonly tasks = new TaskQueue();

  constructor(
    private client: IlinkClient,
    private pi: PiSessionManager,
    private contextStore: ContextStore,
    private readonly accountId: string,
  ) {
    this.slash = new SlashCommandHandler(pi, accountId);
  }

  async run(signal: AbortSignal): Promise<void> {
    let nextTimeout = CONFIG.longPollTimeoutMs;
    logger.info("[bridge] 消息循环已启动，等待微信消息...");
    while (!signal.aborted) {
      try {
        const resp = await this.client.getUpdates(this.getUpdatesBuf, nextTimeout, signal);
        if (signal.aborted) break;

        // 会话超时 → 向上抛出触发重新登录
        if (resp.errcode === -14) throw new SessionTimeoutError();
        if (resp.ret && resp.ret !== 0) {
          throw new ProtocolError(`getUpdates ret=${resp.ret} errmsg=${resp.errmsg ?? ""}`, resp.errcode);
        }

        this.consecutiveFailures = 0;
        if (resp.get_updates_buf) this.getUpdatesBuf = resp.get_updates_buf;
        if (resp.longpolling_timeout_ms) nextTimeout = resp.longpolling_timeout_ms;

        for (const msg of resp.msgs ?? []) {
          // 逐条异步处理，单条失败不影响循环
          this.handleMessage(msg, signal).catch((err) => logger.error(`[bridge] 消息处理失败: ${String(err)}`));
        }
      } catch (err) {
        if (signal.aborted) break;
        // 会话超时 / 鉴权失效 → 向上抛出触发重新登录
        if (err instanceof SessionTimeoutError || err instanceof AuthError) throw err;
        this.consecutiveFailures++;
        const backoff = this.consecutiveFailures >= 5 ? 30_000 : 3_000;
        logger.error(
          `[bridge] getUpdates 错误（连续 ${this.consecutiveFailures} 次），${backoff / 1000}s 后重试: ${String(err)}`,
        );
        try {
          await delay(backoff, undefined, { signal });
        } catch (waitError) {
          if (!signal.aborted) throw waitError;
          break;
        }
      }
    }
    logger.info("[bridge] 消息循环已退出。");
  }

  /** 获取 typing ticket：优先用 contextStore 缓存（未过期），否则 getconfig 刷新 */
  private async getTypingTicket(userId: string, contextToken?: string): Promise<string | undefined> {
    const cached = this.contextStore.getTypingTicket(userId);
    if (cached) return cached;
    try {
      const resp = await this.client.getConfig(userId, contextToken);
      if (resp.typing_ticket) {
        this.contextStore.setTypingTicket(userId, resp.typing_ticket, TICKET_TTL_MS);
      }
      return resp.typing_ticket;
    } catch {
      return undefined;
    }
  }

  /** 发送「正在输入」状态（非关键路径，失败忽略） */
  private async sendTypingSafe(userId: string, contextToken: string | undefined, status: number): Promise<void> {
    const ticket = await this.getTypingTicket(userId, contextToken);
    if (!ticket) return;
    try {
      await this.client.sendTyping({ ilink_user_id: userId, typing_ticket: ticket, status });
    } catch {
      // 输入状态失败不影响主流程
    }
  }

  private async handleMessage(msg: WeixinMessage, signal: AbortSignal): Promise<void> {
    // 仅处理入站用户消息（跳过机器人自身消息，防止循环）
    if (msg.message_type !== MessageType.USER) return;

    const incoming = parseIncomingMessage(msg);
    const from = incoming.fromUserId;
    const key = JSON.stringify([this.accountId, incoming.sessionId || from]);
    const contextToken = incoming.contextToken;

    const sendText = async (text: string) => {
      for (const chunk of chunkText(text)) {
        await this.client.sendMessage(buildTextMessage(chunk, { to: from, contextToken }));
      }
    };
    const notifier = new TaskNotifier(sendText);
    const command = incoming.text.trim().split(/\s+/)[0].toLowerCase();
    // 停止与状态查询必须绕过任务队列，否则无法中断正在等待的附件请求。
    const immediate = ["/stop", "/cancel", "/tasks", "/ping", "/help", "/status", "/usage"].includes(command);
    if (!immediate && (incoming.text.trim() || msg.item_list?.length)) {
      notifier.start();
      notifier.update({ stage: "queued" });
    }
    const operation = (taskSignal: AbortSignal) => this.executeMessage(
      msg, incoming.text, from, key, contextToken, notifier, sendText, taskSignal, signal,
    );
    if (immediate) await operation(signal);
    else await this.tasks.run(key, signal, operation,
      incoming.text.trim().replace(/\s+/g, " ").slice(0, 60) || "附件任务");
  }

  private async executeMessage(
    msg: WeixinMessage,
    text: string,
    from: string,
    key: string,
    contextToken: string | undefined,
    notifier: TaskNotifier,
    sendText: (text: string) => Promise<void>,
    signal: AbortSignal,
    shutdownSignal: AbortSignal,
  ): Promise<void> {
    const onAbort = () => { void notifier.finish(); };
    shutdownSignal.addEventListener("abort", onAbort, { once: true });
    try {
      signal.throwIfAborted();
      notifier.update({ stage: "preparing" });
      await this.processMessage(msg, text, from, key, contextToken, notifier, sendText, signal);
    } catch (error) {
      if (shutdownSignal.aborted) return;
      if (signal.aborted || error instanceof ChatStoppedError) {
        await notifier.finish("⏹ 本次任务已停止。");
        return;
      }
      await notifier.finish(error instanceof DocumentConversionError || error instanceof MediaDownloadError
        ? error.notice : "⚠️ 本次任务处理失败，请检查模型配置和服务日志后重试。");
      throw error;
    } finally {
      shutdownSignal.removeEventListener("abort", onAbort);
      await notifier.finish();
    }
  }

  private async processMessage(
    msg: WeixinMessage,
    text: string,
    from: string,
    key: string,
    contextToken: string | undefined,
    notifier: TaskNotifier,
    sendText: (text: string) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    // 持久化 context_token（用于回复与主动推送，重启可恢复）
    if (contextToken) this.contextStore.setContextToken(from, contextToken);

    // 斜杠命令优先处理（不经过 pi）
    const slashReply = await this.slash.handle(text, { key,
      listTasks: () => this.tasks.list(key),
      cancelTask: (id) => this.tasks.stop(key, id),
      stop: async () => {
      const stopped = this.tasks.stop(key);
      const interrupted = await this.pi.interrupt(key);
      return stopped || interrupted;
    } });
    if (slashReply !== null) {
      logger.info(`[cmd] ${from}: ${text}`);
      await sendText(slashReply);
      return;
    }

    if (!text.trim() && !msg.item_list?.length) return;
    notifier.start();
    // 入站媒体：图片转 base64 供 pi 视觉；文件/视频落盘并以说明注入
    notifier.update({ stage: "downloading" });
    const media = await downloadInboundMedia(msg.item_list, signal);
    const documentNotes = await prepareInboundDocuments(media.files, {
      signal, onConverting: () => notifier.update({ stage: "converting" }),
    });
    let promptText = text;
    if (media.notes.length || documentNotes.length) {
      promptText = [promptText, ...media.notes, ...documentNotes].filter(Boolean).join("\n");
    }
    if (!promptText.trim() && media.images.length) promptText = "请查看这张图片。";
    if (!promptText.trim()) return;
    signal.throwIfAborted();

    logger.info(
      `[in] ${from}: ${promptText.slice(0, 80)}${media.images.length ? `（+${media.images.length} 张图片）` : ""}`,
    );

    // 开始「正在输入」
    await this.sendTypingSafe(from, contextToken, TypingStatus.TYPING);

    // 回复上下文：pi 调用 send_weixin_image 工具时上传并发送图片
    const replyContext: ReplyContext = {
      sendImage: async (path: string) => {
        const uploaded = await uploadImage(this.client, path, from);
        await this.client.sendMessage(buildImageMessage(uploaded, { to: from, contextToken }));
      },
    };

    let reply = "";
    try {
      reply = await this.pi.chat(key, promptText, {
        images: media.images, replyContext, signal, onProgress: (progress) => notifier.update(progress),
      });
    } finally {
      // 取消「正在输入」
      await this.sendTypingSafe(from, contextToken, TypingStatus.CANCEL);
    }

    await notifier.stopProgress();
    signal.throwIfAborted();
    if (!reply) {
      logger.info("[out]（空回复，跳过发送）");
      await sendText("✅ 本次任务已处理完成，没有文本回复。");
      return;
    }
    logger.info(`[out] → ${from}: ${reply.length > 80 ? `${reply.slice(0, 80)}…` : reply}`);
    // 长文本分块发送，避免超出微信单条消息长度限制
    await sendText(reply);
  }
}
