import crypto from "node:crypto";
import { IlinkClient, SessionTimeoutError } from "./ilink/client.js";
import {
  MessageType,
  MessageItemType,
  MessageState,
  TypingStatus,
  type MessageItem,
  type WeixinMessage,
} from "./ilink/types.js";
import { downloadInboundMedia, uploadImage, type UploadedInfo } from "./ilink/media.js";
import { PiSessionManager, type ReplyContext } from "./pi/sessions.js";
import { CONFIG } from "./config.js";

function generateClientId(): string {
  return `pi-weixin-bridge:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

/** 从 item_list 提取正文文本（含语音转文字） */
function extractText(items?: MessageItem[]): string {
  if (!items?.length) return "";
  for (const item of items) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text);
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

export class Bridge {
  private getUpdatesBuf = "";
  private consecutiveFailures = 0;
  /** 按用户缓存 typing_ticket（getConfig 取得） */
  private typingTickets = new Map<string, string>();

  constructor(
    private client: IlinkClient,
    private pi: PiSessionManager,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    let nextTimeout = CONFIG.longPollTimeoutMs;
    console.log("[bridge] 消息循环已启动，等待微信消息...");
    while (!signal.aborted) {
      try {
        const resp = await this.client.getUpdates(this.getUpdatesBuf, nextTimeout, signal);
        if (signal.aborted) break;

        // 会话超时 → 向上抛出触发重新登录
        if (resp.errcode === -14) throw new SessionTimeoutError();
        if (resp.ret && resp.ret !== 0) {
          throw new Error(`getUpdates ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ""}`);
        }

        this.consecutiveFailures = 0;
        if (resp.get_updates_buf) this.getUpdatesBuf = resp.get_updates_buf;
        if (resp.longpolling_timeout_ms) nextTimeout = resp.longpolling_timeout_ms;

        for (const msg of resp.msgs ?? []) {
          // 逐条异步处理，单条失败不影响循环
          this.handleMessage(msg).catch((err) =>
            console.error(`[bridge] 消息处理失败: ${String(err)}`),
          );
        }
      } catch (err) {
        if (signal.aborted) break;
        if (err instanceof SessionTimeoutError) throw err;
        this.consecutiveFailures++;
        const backoff = this.consecutiveFailures >= 5 ? 30_000 : 3_000;
        console.error(
          `[bridge] getUpdates 错误（连续 ${this.consecutiveFailures} 次），${backoff / 1000}s 后重试: ${String(err)}`,
        );
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    console.log("[bridge] 消息循环已退出。");
  }

  /** 获取并缓存用户的 typing_ticket */
  private async getTypingTicket(userId: string, contextToken?: string): Promise<string | undefined> {
    const cached = this.typingTickets.get(userId);
    if (cached) return cached;
    try {
      const resp = await this.client.getConfig(userId, contextToken);
      if (resp.typing_ticket) this.typingTickets.set(userId, resp.typing_ticket);
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

  /** 构造并发送图片消息 */
  private async sendImageMessage(to: string, contextToken: string | undefined, uploaded: UploadedInfo): Promise<void> {
    const imageItem: MessageItem = {
      type: MessageItemType.IMAGE,
      image_item: {
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          // aes_key 字段为 base64(hex 字符串的 ASCII)，与入站 parseAesKey 的 hex 分支对应
          aes_key: Buffer.from(uploaded.aeskeyHex).toString("base64"),
          encrypt_type: 1,
        },
        mid_size: uploaded.fileSizeCiphertext,
      },
    };
    await this.client.sendMessage({
      from_user_id: "",
      to_user_id: to,
      client_id: generateClientId(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: [imageItem],
      context_token: contextToken,
    });
  }

  private async handleMessage(msg: WeixinMessage): Promise<void> {
    // 仅处理入站用户消息（跳过机器人自身消息，防止循环）
    if (msg.message_type !== MessageType.USER) return;

    const from = msg.from_user_id ?? "";
    const key = msg.session_id || from;
    const contextToken = msg.context_token;

    // 入站媒体：图片转 base64 供 pi 视觉；文件/视频落盘并以说明注入
    const media = await downloadInboundMedia(msg.item_list);
    const text = extractText(msg.item_list);
    let promptText = text;
    if (media.notes.length) promptText = [promptText, ...media.notes].filter(Boolean).join("\n");
    if (!promptText.trim() && media.images.length) promptText = "请查看这张图片。";
    if (!promptText.trim()) return;

    console.log(
      `[in] ${from}: ${promptText.slice(0, 80)}${media.images.length ? `（+${media.images.length} 张图片）` : ""}`,
    );

    // 开始「正在输入」
    await this.sendTypingSafe(from, contextToken, TypingStatus.TYPING);

    // 回复上下文：pi 调用 send_weixin_image 工具时上传并发送图片
    const replyContext: ReplyContext = {
      sendImage: async (path: string) => {
        const uploaded = await uploadImage(this.client, path, from);
        await this.sendImageMessage(from, contextToken, uploaded);
      },
    };

    let reply = "";
    try {
      reply = await this.pi.chat(key, promptText, { images: media.images, replyContext });
    } finally {
      // 取消「正在输入」
      await this.sendTypingSafe(from, contextToken, TypingStatus.CANCEL);
    }

    if (!reply) {
      console.log("[out]（空回复，跳过发送）");
      return;
    }
    console.log(`[out] → ${from}: ${reply.length > 80 ? `${reply.slice(0, 80)}…` : reply}`);
    await this.client.sendMessage({
      from_user_id: "",
      to_user_id: from,
      client_id: generateClientId(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: [{ type: MessageItemType.TEXT, text_item: { text: reply } }],
      context_token: contextToken,
    });
  }
}
