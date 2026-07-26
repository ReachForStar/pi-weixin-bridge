// 斜杠命令处理：/help /status /new 等快捷命令，不经过 pi 直接响应。
// 未知斜杠命令返回 null，交由 pi 处理（可能是路径或 pi 命令）。

import type { ContextStore } from "./ilink/context-store.js";
import type { PiSessionManager } from "./pi/sessions.js";

export interface SlashContext {
  /** 会话 key（session_id 或 from_user_id） */
  key: string;
}

const HELP_TEXT = [
  "可用命令：",
  "  /help — 显示本帮助",
  "  /status — 查看服务状态",
  "  /new — 开始新对话（清空当前会话上下文）",
  "",
  "其他消息直接发给 pi 处理。",
].join("\n");

export class SlashCommandHandler {
  constructor(
    private pi: PiSessionManager,
    private contextStore: ContextStore,
    private accountId: string,
  ) {}

  /** 处理斜杠命令；非斜杠命令或未知命令返回 null（交由 pi 处理） */
  async handle(text: string, ctx: SlashContext): Promise<string | null> {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) return null;
    const cmd = trimmed.split(/\s+/)[0].toLowerCase();
    switch (cmd) {
      case "/help":
        return HELP_TEXT;
      case "/status":
        return this.status();
      case "/new":
        return await this.newSession(ctx.key);
      default:
        return null; // 未知命令交给 pi
    }
  }

  private status(): string {
    const users = this.contextStore.knownUsers();
    return [`账号：${this.accountId}`, `已知会话用户：${users.length} 个`, `状态：运行中`].join("\n");
  }

  private async newSession(key: string): Promise<string> {
    await this.pi.resetSession(key);
    return "已开始新对话，当前会话上下文已清空。";
  }
}
