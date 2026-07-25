import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { WORKSPACE } from "../config.js";
import { mkdirSync } from "node:fs";

/**
 * pi 会话管理器：每个微信会话（session_id / from_user_id）对应一个独立的 pi AgentSession，
 * 并对同一会话的 prompt 串行化，避免并发调用同一 session 冲突。
 */
export class PiSessionManager {
  private sessions = new Map<string, AgentSession>();
  private locks = new Map<string, Promise<void>>();
  private modelRuntime?: ModelRuntime;

  async init(): Promise<void> {
    mkdirSync(WORKSPACE, { recursive: true });
    // 复用用户 ~/.pi/agent 下的模型与鉴权配置
    this.modelRuntime = await ModelRuntime.create();
  }

  private async getOrCreate(key: string): Promise<AgentSession> {
    let session = this.sessions.get(key);
    if (!session) {
      const { session: created } = await createAgentSession({
        cwd: WORKSPACE,
        sessionManager: SessionManager.inMemory(WORKSPACE),
        modelRuntime: this.modelRuntime,
      });
      session = created;
      this.sessions.set(key, session);
    }
    return session;
  }

  /** 对外入口：按 key 串行执行对话 */
  async chat(key: string, text: string): Promise<string> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const task: Promise<string> = prev.then(() => this.doChat(key, text));
    // 单个失败不阻断后续排队（转为 Promise<void> 存入锁链）
    this.locks.set(key, task.then(() => {}, () => {}));
    return task;
  }

  private async doChat(key: string, text: string): Promise<string> {
    const session = await this.getOrCreate(key);
    let current = "";
    let final = "";
    const unsubscribe = session.subscribe((event) => {
      const e = event as {
        type: string;
        message?: { role: string };
        assistantMessageEvent?: { type: string; delta?: string };
      };
      // 每条新 assistant 消息重置当前缓冲，仅保留最后一条非空文本作为回复
      if (e.type === "message_start" && e.message?.role === "assistant") {
        current = "";
      } else if (e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta") {
        current += e.assistantMessageEvent.delta ?? "";
      } else if (e.type === "message_end" && e.message?.role === "assistant") {
        if (current.trim()) final = current;
      }
    });
    try {
      await session.prompt(text);
    } finally {
      unsubscribe();
    }
    return (final || current).trim();
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      try {
        session.dispose();
      } catch {
        // 忽略释放异常
      }
    }
    this.sessions.clear();
  }
}
