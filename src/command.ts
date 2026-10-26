// 斜杠命令处理：/help /status /new /model /skill /mcp /usage /stop /ping，不经过 pi 直接响应。
// 回复按 markdown 列表组织（微信端按 markdown 渲染，单 \n 会被折成空格）。
// 未知斜杠命令返回 null，交由 pi 处理（可能是路径或 pi 命令）。

import type { PiSessionManager } from "./pi/sessions.js";
import { BRIDGE_VERSION, WORKSPACE } from "./config.js";
import { listSkills, listMcpServers, skillDirective, mcpDirective } from "./catalog.js";
import type { TaskInfo } from "./message/task-queue.js";

export interface SlashContext {
  /** 会话 key（session_id 或 from_user_id） */
  key: string;
  stop?: () => Promise<boolean>;
  listTasks?: () => TaskInfo[];
  cancelTask?: (id: string) => boolean;
}

const LIST_MAX = 100;

const HELP_TEXT = [
  "📋 可用命令",
  "",
  "1. /help — 显示本帮助",
  "2. /status — 服务状态",
  "3. /new — 开始新对话",
  "4. /model — 当前会话模型；/model list 查看 models.json；/model <编号或供应方/模型> 切换当前会话并保存",
  "5. /skill — skill 列表；/skill <名称> 下一条消息按该 skill 处理",
  "6. /mcp — MCP server 列表；/mcp <名称> 下一条消息调用其工具",
  "7. /reload — 重载模型配置（models.json 改动立即生效）",
  "8. /usage — 当前对话用量",
  "9. /stop — 停止当前对话的任务（含附件处理和等待中的消息）",
  "10. /ping — 存活检查",
  "11. /tasks — 查看当前对话正在处理和等待中的任务",
  "12. /cancel <任务编号> — 取消指定任务，其余任务继续",
  "13. /sessions — 当前项目历史；/resume <编号> 切换；/rename <名称> 命名；/export 导出 HTML",
  "14. /files — 资料列表；/files find <关键词> 检索；/file <编号> 取回原件；/file <编号> markdown 取回转换结果",
  "15. /ocr <文件编号> — 扫描文档云端 OCR，逐文件确认后上传 Firecrawl",
  "16. /history — 持久任务记录；/result <编号> 查看结果；/retry <编号> 经确认后重新处理",
  "17. /project — 查看项目；/project <名称> 切换配置的工作目录与工具权限",
  "18. /schedule — 查看定时任务；/schedule pause|resume|delete <编号> 管理",
  '19. /schedule add {"prompt":"任务指令","cron":"0 9 * * *","timeZone":"Asia/Shanghai"} — 周期任务',
  '20. /schedule add {"prompt":"任务指令","at":"2026-10-01T09:00:00+08:00","timeZone":"Asia/Shanghai"} — 单次任务（使用未来日期）',
  "21. /approve <编号> — 同意当前操作；/reject <编号> 拒绝；确认超时不执行",
  "22. /daily — 今日已报告用量；/doctor — 只读本地诊断",
  "",
  "权限：管理员可切换配置、创建定时任务和确认操作；白名单普通用户只读。文件回传限定当前项目目录。",
  "其他消息直接发给 pi 处理。",
].join("\n");

/** 秒数 → 人类可读时长 */
function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h) return `${h} 小时 ${m} 分`;
  if (m) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

/** Token 数 → 紧凑显示（≥1000 用 k） */
function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export class SlashCommandHandler {
  constructor(
    private pi: PiSessionManager,
    private accountId: string,
  ) {}

  /** 处理斜杠命令；非斜杠命令或未知命令返回 null（交由 pi 处理）；命令抛错时回复友好提示而非静默失败 */
  async handle(text: string, ctx: SlashContext): Promise<string | null> {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) return null;
    const cmd = trimmed.split(/\s+/)[0].toLowerCase();
    try {
      switch (cmd) {
        case "/help":
          return HELP_TEXT;
        case "/status":
          return this.status();
        case "/new":
          return await this.newSession(ctx.key);
        case "/model":
          return this.modelCommand(trimmed, ctx.key);
        case "/skill":
          return this.skillCommand(trimmed, ctx.key);
        case "/mcp":
          return this.mcpCommand(trimmed, ctx.key);
        case "/reload":
          return await this.pi.reload();
        case "/usage":
          return this.usage(ctx.key);
        case "/stop":
          return await this.stop(ctx);
        case "/ping":
          return "🏓 pong";
        case "/tasks":
          return this.tasks(ctx);
        case "/cancel": {
          const id = trimmed.slice("/cancel".length).trim();
          if (!id) return "用法：/cancel <任务编号>，用 /tasks 查看编号。";
          if (!ctx.cancelTask) return "当前没有可取消的任务。";
          return ctx.cancelTask(id) ? `⏹ 已请求取消任务 ${id}，其余任务继续。`
            : "当前对话未找到该任务，可能已经结束；用 /tasks 查看。";
        }
        default:
          return null; // 未知命令交给 pi
      }
    } catch (err) {
      return `⚠️ 命令执行失败：${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** /model 查看 / 切换 / 列表 */
  private async modelCommand(text: string, key: string): Promise<string> {
    const arg = text.trim().slice("/model".length).trim();
    if (!arg) {
      return `当前模型：${this.pi.getSessionModelRef(key)}`;
    }
    if (arg.toLowerCase() === "list") {
      return await this.pi.listModels();
    }
    return await this.pi.switchSessionModel(key, arg);
  }

  /** /skill 列表 / 设置下一条消息的 skill 指令 */
  private skillCommand(text: string, key: string): string {
    const arg = text.trim().slice("/skill".length).trim();
    const skills = listSkills();
    if (!arg) {
      const lines = [`📋 可用 skill（${Math.min(skills.length, LIST_MAX)}）`, ""];
      skills.slice(0, LIST_MAX).forEach((s, i) => {
        lines.push(`${i + 1}. ${s.name}${s.description ? ` — ${s.description}` : ""}`);
      });
      if (skills.length > LIST_MAX) lines.push(`… 另有 ${skills.length - LIST_MAX} 个`);
      return lines.join("\n");
    }
    const info = skills.find((s) => s.name.toLowerCase() === arg.toLowerCase());
    if (!info) return `未找到 skill：\`${arg}\`（/skill 查看列表）`;
    this.pi.setDirective(key, skillDirective(info));
    return `下一条消息将按 skill「${info.name}」处理。`;
  }

  /** /mcp 列表 / 设置下一条消息的 MCP 调用指令 */
  private mcpCommand(text: string, key: string): string {
    const arg = text.trim().slice("/mcp".length).trim();
    const servers = listMcpServers();
    if (!arg) {
      if (!servers.length) return "未配置 MCP server（~/.pi/agent/mcp.json）。";
      const lines = [`📋 MCP server（${Math.min(servers.length, LIST_MAX)}）`, ""];
      servers.slice(0, LIST_MAX).forEach((s, i) => {
        lines.push(`${i + 1}. ${s.name}${s.command ? ` — \`${s.command}\`` : ""}`);
      });
      if (servers.length > LIST_MAX) lines.push(`… 另有 ${servers.length - LIST_MAX} 个`);
      return lines.join("\n");
    }
    const info = servers.find((s) => s.name.toLowerCase() === arg.toLowerCase());
    if (!info) return `未找到 MCP server：\`${arg}\`（/mcp 查看列表）`;
    this.pi.setDirective(key, mcpDirective(info));
    return `下一条消息将调用 MCP「${info.name}」的工具处理。`;
  }

  private status(): string {
    return [
      "📊 服务状态",
      "",
      `- 版本：${BRIDGE_VERSION}`,
      `- 账号：${this.accountId}`,
      `- 模型：${this.pi.getModelRef()}`,
      `- 工作目录：${WORKSPACE}`,
      `- 运行时长：${formatUptime(process.uptime())}`,
      `- 会话：${this.pi.sessionCount()} 个（${this.pi.busyCount()} 个处理中）`,
    ].join("\n");
  }

  /** /usage 当前对话用量（会话不存在时不创建） */
  private usage(key: string): string {
    const stats = this.pi.getSessionStats(key);
    if (!stats) return "当前对话还没有会话（发条消息就会开始）。";
    const lines = [
      "📊 当前对话用量",
      "",
      `- 消息：用户 ${stats.userMessages} / 助手 ${stats.assistantMessages}`,
      `- 工具调用：${stats.toolCalls} 次`,
      `- Token：输入 ${fmtTokens(stats.tokens.input)} / 输出 ${fmtTokens(stats.tokens.output)} / 缓存读 ${fmtTokens(stats.tokens.cacheRead)}，共 ${fmtTokens(stats.tokens.total)}`,
      `- 成本：$${stats.cost.toFixed(4)}`,
    ];
    const ctx = stats.contextUsage;
    if (ctx?.tokens != null && ctx.percent != null) {
      lines.push(`- 上下文：${ctx.percent.toFixed(1)}%（${fmtTokens(ctx.tokens)} / ${fmtTokens(ctx.contextWindow)}）`);
    }
    // provider 未返回 usage 时 tokens 全 0（如部分 OpenAI 兼容代理/自建 vllm 不回传 stream usage），
    // 明确提示是服务端行为而非统计故障
    if (stats.tokens.total === 0 && stats.assistantMessages > 0) {
      lines.push("- 注意：当前模型服务未返回用量数据，Token/成本无法统计（上下文为本地估算）");
    }
    return lines.join("\n");
  }

  private tasks(ctx: SlashContext): string {
    const tasks = ctx.listTasks?.() ?? [];
    if (!tasks.length) return "当前对话没有正在处理或等待中的任务。";
    const labels = { queued: "等待中", running: "处理中", stopping: "停止中" };
    const lines = [`📋 当前对话任务（${tasks.length}）`, ""];
    for (const task of tasks.slice(0, 20)) {
      const seconds = Math.floor((Date.now() - (task.startedAt ?? task.createdAt)) / 1000);
      lines.push(`- ${task.id.slice(0, 8)} · ${labels[task.state]} · ${seconds} 秒 · ${task.description}`);
    }
    if (tasks.length > 20) lines.push(`- 另有 ${tasks.length - 20} 条任务`);
    lines.push("", "使用 /cancel <任务编号> 取消一条，/stop 停止全部。");
    return lines.join("\n");
  }

  /** /stop 中断该对话进行中的任务 */
  private async stop(ctx: SlashContext): Promise<string> {
    const ok = await (ctx.stop ? ctx.stop() : this.pi.interrupt(ctx.key));
    return ok ? "⏹ 已请求停止当前对话的任务和等待中的消息。" : "当前没有进行中的任务。";
  }

  private async newSession(key: string): Promise<string> {
    await this.pi.resetSession(key);
    return "已开始新对话，上下文已清空。";
  }
}
