import {
  createAgentSession,
  defineTool,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WORKSPACE } from "../config.js";
import { mkdirSync } from "node:fs";

/** 当前消息的回复上下文（供自定义工具回发媒体） */
export interface ReplyContext {
  /** 把本地图片发送到当前微信对话（由 bridge 实现上传+发送） */
  sendImage: (path: string) => Promise<void>;
}

export interface ChatOptions {
  /** 入站图片（base64），供 pi 视觉理解 */
  images?: Array<{ mimeType: string; data: string }>;
  replyContext?: ReplyContext;
}

/**
 * pi 会话管理器：每个微信会话（session_id / from_user_id）对应一个独立的 pi AgentSession，
 * 并对同一会话的 prompt 串行化，避免并发调用同一 session 冲突。
 */
export class PiSessionManager {
  private sessions = new Map<string, AgentSession>();
  private locks = new Map<string, Promise<void>>();
  private replyContexts = new Map<string, ReplyContext>();
  private modelRuntime?: ModelRuntime;

  async init(): Promise<void> {
    mkdirSync(WORKSPACE, { recursive: true });
    // 复用用户 ~/.pi/agent 下的模型与鉴权配置
    this.modelRuntime = await ModelRuntime.create();
  }

  /** 每个会话注册一个 send_weixin_image 工具，闭包绑定会话 key 以取用对应回复上下文 */
  private createSendImageTool(key: string) {
    return defineTool({
      name: "send_weixin_image",
      label: "发送微信图片",
      description:
        "把本地图片文件发送到当前微信对话。当你需要向用户发送图片（例如生成的图片、图表）时调用此工具，参数为图片文件的绝对路径。",
      parameters: Type.Object({
        path: Type.String({ description: "图片文件的绝对路径" }),
      }),
      execute: async (_toolCallId, params: { path: string }) => {
        const ctx = this.replyContexts.get(key);
        if (!ctx) {
          return { content: [{ type: "text", text: "当前无回复上下文，无法发送" }], details: {} };
        }
        try {
          await ctx.sendImage(params.path);
          return { content: [{ type: "text", text: `图片已发送：${params.path}` }], details: {} };
        } catch (err) {
          return {
            content: [{ type: "text", text: `图片发送失败：${String(err)}` }],
            details: {},
            isError: true,
          };
        }
      },
    });
  }

  private async getOrCreate(key: string): Promise<AgentSession> {
    let session = this.sessions.get(key);
    if (!session) {
      const { session: created } = await createAgentSession({
        cwd: WORKSPACE,
        sessionManager: SessionManager.inMemory(WORKSPACE),
        modelRuntime: this.modelRuntime,
        customTools: [this.createSendImageTool(key)],
      });
      session = created;
      this.sessions.set(key, session);
    }
    return session;
  }

  /** 对外入口：按 key 串行执行对话 */
  async chat(key: string, text: string, options: ChatOptions = {}): Promise<string> {
    if (options.replyContext) this.replyContexts.set(key, options.replyContext);
    const prev = this.locks.get(key) ?? Promise.resolve();
    const task: Promise<string> = prev.then(() => this.doChat(key, text, options.images));
    // 单个失败不阻断后续排队（转为 Promise<void> 存入锁链）
    this.locks.set(key, task.then(() => {}, () => {}));
    return task;
  }

  private async doChat(
    key: string,
    text: string,
    images?: Array<{ mimeType: string; data: string }>,
  ): Promise<string> {
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
      const promptImages = images?.length
        ? images.map((img) => ({ type: "image" as const, mimeType: img.mimeType, data: img.data }))
        : undefined;
      await session.prompt(text, promptImages ? { images: promptImages } : undefined);
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
