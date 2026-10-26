import { IlinkClient, SessionTimeoutError } from "./ilink/client.js";
import { AuthError, ProtocolError } from "./ilink/errors.js";
import { MessageType, TypingStatus, type WeixinMessage } from "./ilink/types.js";
import { downloadInboundMedia, MediaDownloadError, uploadImage, uploadFile } from "./ilink/media.js";
import { ContextStore } from "./ilink/context-store.js";
import { parseIncomingMessage } from "./message/parser.js";
import { buildImageMessage, buildTextMessage, buildFileMessage } from "./message/builder.js";
import { chunkText } from "./message/markdown.js";
import { TaskNotifier } from "./message/task-notifier.js";
import { TaskQueue } from "./message/task-queue.js";
import { DocumentConversionError } from "./message/documents.js";
import { SlashCommandHandler } from "./command.js";
import { ChatStoppedError, PiSessionManager, type ReplyContext } from "./pi/sessions.js";
import { CONFIG } from "./config.js";
import { logger } from "./logger/index.js";
import { setTimeout as delay } from "node:timers/promises";
import { basename } from "node:path";
import { stat } from "node:fs/promises";
import { Features, type FeatureContext } from "./features/service.js";
import type { ScheduledJob } from "./features/scheduler.js";

class CommandExecutionError extends Error {
  readonly notice: string;
  constructor(error: unknown) {
    super("微信命令执行失败", { cause: error });
    this.notice = `⚠️ 命令执行失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

/** typing ticket 缓存时长（过期后重新 getconfig 获取） */
const TICKET_TTL_MS = 50 * 60 * 1000;

export class Bridge {
  private getUpdatesBuf = "";
  private consecutiveFailures = 0;
  private slash: SlashCommandHandler;
  private readonly tasks = new TaskQueue();
  private readonly features: Features;
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private client: IlinkClient,
    private pi: PiSessionManager,
    private contextStore: ContextStore,
    private readonly accountId: string,
  ) {
    this.slash = new SlashCommandHandler(pi, accountId);
    this.features = new Features(pi, accountId);
  }

  async run(signal: AbortSignal): Promise<void> {
    const lifetime = new AbortController();
    const taskSignal = AbortSignal.any([signal, lifetime.signal]);
    const schedulerTimer = setInterval(() => {
      const tick = this.features.scheduler.tick(this.accountId, (job) => this.runScheduled(job, taskSignal), taskSignal)
        .catch((error) => logger.error(`[schedule] 调度失败：${String(error)}`));
      this.pending.add(tick);
      void tick.finally(() => this.pending.delete(tick));
    }, 1000);
    let nextTimeout = CONFIG.longPollTimeoutMs;
    logger.info("[bridge] 消息循环已启动，等待微信消息...");
    try {
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
          const task = this.handleMessage(msg, taskSignal).catch((err) => logger.error(`[bridge] 消息处理失败: ${String(err)}`));
          this.pending.add(task);
          void task.finally(() => this.pending.delete(task));
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
    } finally {
      clearInterval(schedulerTimer);
      lifetime.abort();
      await Promise.allSettled([...this.pending]);
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
    if (!from || !this.features.policy.identity(from).allowed) return;
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
    const immediate = ["/stop", "/cancel", "/tasks", "/approve", "/reject", "/ping", "/help", "/status", "/usage", "/daily", "/doctor", "/history", "/result"].includes(command);
    if (!immediate && (incoming.text.trim() || msg.item_list?.length)) {
      notifier.start();
      notifier.update({ stage: "queued" });
    }
    const operation = async (taskSignal: AbortSignal) => {
      const record = this.features.journal.begin(key, incoming.text, this.features.policy.selectedProject(key), msg.message_id);
      if (!record) { await notifier.finish(); return; }
      try {
        let result = "";
        const state = await this.executeMessage(msg, incoming.text, from, key, contextToken, notifier,
          async (text) => { await sendText(text); result = text; }, taskSignal, signal, record.id);
        this.features.journal.update(key, record.id, { state, result });
      } catch (error) {
        this.features.journal.update(key, record.id, { state: "failed", error: "处理或投递失败，请检查服务日志" });
        throw error;
      }
    };
    if (immediate) await this.executeMessage(msg, incoming.text, from, key, contextToken, notifier, sendText, signal, signal);
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
    recordId?: string,
  ): Promise<"completed" | "stopped" | "interrupted"> {
    const onAbort = () => { void notifier.finish(); };
    shutdownSignal.addEventListener("abort", onAbort, { once: true });
    try {
      signal.throwIfAborted();
      notifier.update({ stage: "preparing" });
      await this.processMessage(msg, text, from, key, contextToken, notifier, sendText, signal, recordId);
      return "completed";
    } catch (error) {
      if (shutdownSignal.aborted) return "interrupted";
      if (signal.aborted || error instanceof ChatStoppedError) {
        await notifier.finish("⏹ 本次任务已停止。");
        return "stopped";
      }
      await notifier.finish(error instanceof DocumentConversionError || error instanceof MediaDownloadError || error instanceof CommandExecutionError
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
    recordId?: string,
  ): Promise<void> {
    // 持久化 context_token（用于回复与主动推送，重启可恢复）
    if (contextToken) this.contextStore.setContextToken(from, contextToken);

    const ctx: FeatureContext = { key, user: from, signal, send: sendText,
      sendFile: async (path) => {
        const checked = await this.features.filePath(ctx, path);
        const uploaded = await uploadFile(this.client, checked, from, signal);
        signal.throwIfAborted();
        await this.client.sendMessage(buildFileMessage(uploaded, basename(checked), { to: from, contextToken }));
      } };
    const name = text.trim().split(/\s+/)[0].toLowerCase();
    if (!["/approve", "/reject", "/stop", "/cancel", "/tasks", "/ping", "/help", "/status", "/usage", "/history", "/result", "/daily", "/doctor", "/project"].includes(name)) this.pi.configure(key, this.features.policy.profile(key, from));
    if (!this.features.policy.identity(from).admin && ["/reload", "/mcp", "/skill"].includes(name)) throw new Error("此命令仅管理员可用");
    let featureReply;
    try { featureReply = await this.features.command(text, ctx); }
    catch (error) {
      if (signal.aborted || error instanceof DocumentConversionError) throw error;
      throw new CommandExecutionError(error);
    }
    if (featureReply?.reply !== undefined) { await sendText(featureReply.reply); return; }
    if (featureReply?.prompt) text = featureReply.prompt;

    // 斜杠命令优先处理（不经过 pi）
    const slashReply = await this.slash.handle(text, { key,
      listTasks: () => this.tasks.list(key),
      cancelTask: (id) => this.tasks.stop(key, id),
      stop: async () => {
      this.features.approvals.cancel(key);
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
    const profile = this.features.policy.profile(key, from);
    notifier.start();
    // 入站媒体：图片转 base64 供 pi 视觉；文件/视频落盘并以说明注入
    notifier.update({ stage: "downloading" });
    const media = await downloadInboundMedia(msg.item_list, signal, profile.workspace);
    const files = [];
    for (const file of media.files) {
      if ((await stat(file.path)).size > this.features.policy.maxFileBytes()) throw new Error("附件超过配置大小上限");
      files.push(await this.features.library.add(key, file, profile.workspace));
    }
    if (recordId) this.features.journal.update(key, recordId, { files: files.map((file) => file.id) });
    notifier.update({ stage: "converting" });
    const documentNotes = await this.features.convert(ctx, files);
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
        const checked = await this.features.filePath(ctx, path);
        const uploaded = await uploadImage(this.client, checked, from, signal);
        signal.throwIfAborted();
        await this.client.sendMessage(buildImageMessage(uploaded, { to: from, contextToken }));
      },
      sendFile: ctx.sendFile,
      approve: (description, approvalSignal) => this.features.approvals.request(key, description, sendText,
        approvalSignal ? AbortSignal.any([signal, approvalSignal]) : signal),
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

  private async runScheduled(job: ScheduledJob, signal: AbortSignal): Promise<void> {
    if (!this.features.policy.identity(job.user).admin) throw new Error("定时任务所有者已无管理员权限");
    const token = this.contextStore.getContextToken(job.user);
    if (!token) throw new Error("缺少微信上下文，请先向机器人发送消息");
    const task = this.tasks.run(job.key, signal, async (taskSignal) => {
      taskSignal.throwIfAborted();
      const selected = this.features.policy.profile(job.key, job.user);
      if (selected.name !== job.project) throw new Error("项目已切换，请切回原项目后重新启用定时任务");
      const scheduledKey = JSON.stringify([job.key, "schedule", job.id]);
      this.pi.configure(scheduledKey, { ...selected, permission: selected.permission === "full" ? "full" : "read-only" });
      await this.pi.resetSession(scheduledKey);
      const reply = await this.pi.chat(scheduledKey, job.prompt, { signal: taskSignal, usageKey: job.key });
      taskSignal.throwIfAborted();
      for (const chunk of chunkText(reply || "定时任务已完成，没有文本结果。")) {
        await this.client.sendMessage(buildTextMessage(chunk, { to: job.user, contextToken: token }));
      }
    }, `定时任务 ${job.id.slice(0, 8)}`);
    this.pending.add(task);
    try { await task; }
    catch (error) {
      if (!signal.aborted) {
        try { await this.client.sendMessage(buildTextMessage(`⚠️ 定时任务 ${job.id.slice(0, 8)} 处理或投递失败，已暂停；/schedule 查看记录，检查日志后可恢复。`, { to: job.user, contextToken: token })); }
        catch (deliveryError) { logger.error(`[schedule] 失败通知未投递：${String(deliveryError)}`); }
      }
      throw error;
    } finally { this.pending.delete(task); }
  }
}
