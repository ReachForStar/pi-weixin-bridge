// 斜杠命令处理：/help /status /new /model /skill /mcp /usage /stop /ping，不经过 pi 直接响应。
// 回复按 markdown 列表组织（微信端按 markdown 渲染，单 \n 会被折成空格）。
// 未知斜杠命令返回 null，交由 pi 处理（可能是路径或 pi 命令）。

import type { PiSessionManager } from "./pi/sessions.js";
import { BRIDGE_VERSION, WORKSPACE } from "./config.js";
import { listSkills, listMcpServers, skillDirective, mcpDirective } from "./catalog.js";

export interface SlashContext {
  /** 会话 key（session_id 或 from_user_id） */
  key: string;
}

const LIST_MAX = 100;

const HELP_TEXT = [
  "📋 可用命令",
  "",
  "1. /help — 显示本帮助",
  "2. /status — 服务状态",
  "3. /new — 开始新对话",
  "4. /model — 查看当前模型；/model list 列表；/model <provider/modelId> 切换",
  "5. /skill — skill 列表；/skill <名称> 下一条消息按该 skill 处理",
  "6. /mcp — MCP server 列表；/mcp <名称> 下一条消息调用其工具",
  "7. /usage — 当前对话用量",
  "8. /stop — 停止进行中的任务",
  "9. /ping — 存活检查",
  "",
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
      case "/model":
        return this.modelCommand(trimmed);
      case "/skill":
        return this.skillCommand(trimmed, ctx.key);
      case "/mcp":
        return this.mcpCommand(trimmed, ctx.key);
      case "/usage":
        return this.usage(ctx.key);
      case "/stop":
        return await this.stop(ctx.key);
      case "/ping":
        return "🏓 pong";
      default:
        return null; // 未知命令交给 pi
    }
  }

  /** /model 查看 / 切换 / 列表 */
  private async modelCommand(text: string): Promise<string> {
    const arg = text.trim().slice("/model".length).trim();
    if (!arg) {
      return `当前模型：${this.pi.getModelRef()}`;
    }
    if (arg.toLowerCase() === "list") {
      return await this.pi.listModels();
    }
    return await this.pi.switchModel(arg);
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
    if (!info) return `未找到 skill：${arg}（/skill 查看列表）`;
    this.pi.setDirective(key, skillDirective(info));
    return `下一条消息将按 skill「${info.name}」处理。`;
  }

  /** /mcp 列表 / 设置下一条消息的 MCP 调用指令 */
  private mcpCommand(text: string, key: string): string {
    const arg = text.trim().slice("/mcp".length).trim();
    const servers = listMcpServers();
    if (!arg) {
      if (!servers.length) return "未配置 MCP server（~/.pi/agent/mcp.json）。";
      const lines = [`📋 MCP server（${servers.length}）`, ""];
      servers.forEach((s, i) => {
        lines.push(`${i + 1}. ${s.name}${s.command ? ` — \`${s.command}\`` : ""}`);
      });
      return lines.join("\n");
    }
    const info = servers.find((s) => s.name.toLowerCase() === arg.toLowerCase());
    if (!info) return `未找到 MCP server：${arg}（/mcp 查看列表）`;
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
    return lines.join("\n");
  }

  /** /stop 中断该对话进行中的任务 */
  private async stop(key: string): Promise<string> {
    const ok = await this.pi.interrupt(key);
    return ok ? "⏹ 已停止当前进行中的任务。" : "当前没有进行中的任务。";
  }

  private async newSession(key: string): Promise<string> {
    await this.pi.resetSession(key);
    return "已开始新对话，上下文已清空。";
  }
}
