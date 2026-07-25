import crypto from "node:crypto";
import { IlinkClient, SessionTimeoutError } from "./ilink/client.js";
import {
  MessageType,
  MessageItemType,
  MessageState,
  type MessageItem,
  type WeixinMessage,
} from "./ilink/types.js";
import { PiSessionManager } from "./pi/sessions.js";
import { CONFIG } from "./config.js";

function generateClientId(): string {
  return `pi-weixin-bridge:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

/** 从 item_list 提取文本（MVP：取首个 TEXT 项） */
function extractText(items?: MessageItem[]): string {
  if (!items?.length) return "";
  for (const item of items) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text);
    }
  }
  return "";
}

export class Bridge {
  private getUpdatesBuf = "";
  private consecutiveFailures = 0;

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

  private async handleMessage(msg: WeixinMessage): Promise<void> {
    // 仅处理入站用户文本消息（跳过机器人自身消息，防止循环）
    if (msg.message_type !== MessageType.USER) return;
    const text = extractText(msg.item_list);
    if (!text.trim()) return;

    const from = msg.from_user_id ?? "";
    const key = msg.session_id || from;
    console.log(`[in] ${from}: ${text}`);

    const reply = await this.pi.chat(key, text);
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
      context_token: msg.context_token,
    });
  }
}
