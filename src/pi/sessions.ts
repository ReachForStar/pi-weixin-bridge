import {
  createAgentSession,
  defineTool,
  ModelRuntime,
  SessionManager,
  getAgentDir,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { MODEL_REF, saveSettings, WORKSPACE } from "../config.js";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger/index.js";

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
  /** 正在处理 prompt 的会话 key（/stop、/status 用） */
  private busy = new Set<string>();
  /** 一次性指令（/skill、/mcp 设置，拼到该会话下一条消息前） */
  private pendingDirectives = new Map<string, string>();
  private modelRuntime?: ModelRuntime;
  /** 当前生效的模型引用（provider/modelId）；/model 切换时更新并持久化 */
  private modelRef = MODEL_REF;
  private modelWarned = false;

  /** 初始化；可注入 ModelRuntime（测试用），默认读 ~/.pi/agent 配置 */
  async init(runtime?: ModelRuntime): Promise<void> {
    mkdirSync(WORKSPACE, { recursive: true });
    // 复用用户 ~/.pi/agent 下的模型与鉴权配置
    this.modelRuntime = runtime ?? (await ModelRuntime.create());
  }

  /** 设置一次性指令（该会话下一条普通消息前拼接；同 key 覆盖） */
  setDirective(key: string, directive: string): void {
    this.pendingDirectives.set(key, directive);
  }

  /** 取出并清除该会话的一次性指令（无则返回 undefined） */
  consumeDirective(key: string): string | undefined {
    const d = this.pendingDirectives.get(key);
    if (d) this.pendingDirectives.delete(key);
    return d;
  }

  /** 当前模型引用 */
  getModelRef(): string {
    return this.modelRef;
  }

  /** 活动 pi 会话数 */
  sessionCount(): number {
    return this.sessions.size;
  }

  /** 正在处理中的对话数 */
  busyCount(): number {
    return this.busy.size;
  }

  /** 当前对话的用量统计（会话不存在时返回 undefined，不创建） */
  getSessionStats(key: string): ReturnType<AgentSession["getSessionStats"]> | undefined {
    return this.sessions.get(key)?.getSessionStats();
  }

  /** 请求停止该对话进行中的任务；返回是否发出了停止请求 */
  async interrupt(key: string): Promise<boolean> {
    const session = this.sessions.get(key);
    if (!session || !this.busy.has(key)) return false;
    try {
      await session.abort();
    } catch {
      // 可能刚好已跑完，视为已停止
    }
    return true;
  }

  /** 解析 provider/modelId → Model；格式不对或 provider 未注册时返回 undefined */
  private resolveModel(ref: string): ReturnType<ModelRuntime["getModel"]> {
    const idx = ref.indexOf("/");
    if (idx <= 0 || idx === ref.length - 1) return undefined;
    const provider = ref.slice(0, idx);
    const modelId = ref.slice(idx + 1);
    return this.modelRuntime?.getModel(provider, modelId);
  }

  /** 切换模型：应用到所有已有会话 + 持久化为新会话默认（重启后保持） */
  async switchModel(ref: string): Promise<string> {
    const model = this.resolveModel(ref);
    if (!model) {
      return `未找到模型：${ref}`;
    }
    const prev = this.modelRef;
    this.modelRef = ref;
    const results = await Promise.allSettled(
      [...this.sessions.values()].map((s) => s.setModel(model)),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    try {
      saveSettings({ model: ref });
    } catch (err) {
      logger.warn(`[pi] 模型选择持久化失败: ${String(err)}`);
    }
    if (failed > 0) {
      return `已切换到 ${ref}（${failed} 个进行中会话切换失败，新会话生效）`;
    }
    return `已从 ${prev} 切换到 ${ref}（已保存为默认，重启后保持）`;
  }

  /** 用户 models.json 注册的 provider（按注册顺序）；读不到时返回空 */
  private userRegisteredProviders(): string[] {
    try {
      const file = join(getAgentDir(), "models.json");
      if (!existsSync(file)) return [];
      const data = JSON.parse(readFileSync(file, "utf8"));
      return Object.keys(data.providers ?? {});
    } catch {
      return [];
    }
  }

  /** 列出可用模型：只列用户 models.json 注册的 provider（内置目录上千个模型会淹没真正可用的）；
   * 无用户配置时回退到有鉴权的模型；当前模型加 * 标记 */
  async listModels(): Promise<string> {
    if (!this.modelRuntime) return "模型运行时未初始化";
    const providers = this.userRegisteredProviders();
    const all = this.modelRuntime.getModels();
    let models = providers.length
      ? providers.flatMap((p) => all.filter((m) => m.provider === p))
      : await this.modelRuntime.getAvailable();
    if (!models.length) models = await this.modelRuntime.getAvailable();
    if (!models.length) return "没有可用模型（检查 ~/.pi/agent/models.json 配置）";
    const MAX = 100;
    const lines = [`📋 可用模型（${Math.min(models.length, MAX)}）`, ""];
    models.slice(0, MAX).forEach((m, i) => {
      const ref = `${m.provider}/${m.id}`;
      lines.push(`${i + 1}. ${ref}${ref === this.modelRef ? " ✓ 当前" : ""}`);
    });
    if (models.length > MAX) lines.push(`… 另有 ${models.length - MAX} 个`);
    return lines.join("\n");
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
      // 初始模型：当前模型引用（环境变量 > config.json > 内置默认）；
      // provider 未注册时回退 pi 默认模型，避免服务启动失败
      const model = this.resolveModel(this.modelRef);
      if (!model && !this.modelWarned) {
        this.modelWarned = true;
        logger.warn(`[pi] 模型 ${this.modelRef} 未在当前 pi 配置中注册，回退 pi 默认模型（/model list 查看可用）`);
      }
      const { session: created } = await createAgentSession({
        cwd: WORKSPACE,
        sessionManager: SessionManager.inMemory(WORKSPACE),
        modelRuntime: this.modelRuntime,
        ...(model ? { model } : {}),
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
    // 消费一次性指令（/skill、/mcp）：拼到本条消息前，仅生效一次
    const directive = this.consumeDirective(key);
    const promptText = directive ? `${directive}\n\n${text}` : text;
    const prev = this.locks.get(key) ?? Promise.resolve();
    const task: Promise<string> = prev.then(() => this.doChat(key, promptText, options.images));
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
    this.busy.add(key);
    try {
      const promptImages = images?.length
        ? images.map((img) => ({ type: "image" as const, mimeType: img.mimeType, data: img.data }))
        : undefined;
      await session.prompt(text, promptImages ? { images: promptImages } : undefined);
    } finally {
      this.busy.delete(key);
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

  /** 重置指定会话（dispose 并移除，下次 chat 时新建）——用于 /new 命令 */
  async resetSession(key: string): Promise<void> {
    // 等待该会话的串行锁完成，避免重置与正在进行的对话冲突
    const prev = this.locks.get(key);
    if (prev) await prev.catch(() => {});
    const session = this.sessions.get(key);
    if (session) {
      try {
        session.dispose();
      } catch {
        // 忽略释放异常
      }
      this.sessions.delete(key);
    }
    this.replyContexts.delete(key);
  }
}
