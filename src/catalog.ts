// skill 与 MCP 目录：/skill、/mcp 命令的列表数据源。
// skill 发现范围与 pi 会话一致：agentDir/skills（用户）、~/.agents/skills（共享）、WORKSPACE/.pi/skills（项目）。

import { loadSkillsFromDir, getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { WORKSPACE } from "./config.js";
import { logger } from "./logger/index.js";

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
}

export interface McpServerInfo {
  name: string;
  command: string;
}

/** 可用 skill（按名称去重，先出现者优先） */
export function listSkills(): SkillInfo[] {
  const dirs = [
    join(getAgentDir(), "skills"),
    join(homedir(), ".agents", "skills"),
    join(WORKSPACE, ".pi", "skills"),
  ];
  const seen = new Set<string>();
  const out: SkillInfo[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      // 单个目录坏文件不拖垮整个列表
      for (const s of loadSkillsFromDir({ dir, source: "catalog" }).skills) {
        if (seen.has(s.name)) continue;
        seen.add(s.name);
        out.push({
          name: s.name,
          description: (s.description || "").split("\n")[0].slice(0, 60),
          filePath: s.filePath,
        });
      }
    } catch (err) {
      logger.warn(`skill 目录 ${dir} 读取失败（已跳过）：${String(err)}`);
    }
  }
  return out;
}

/**
 * 清洗外部来源字符串（skill 名、路径、命令）：去除换行与控制字符并限长。
 * 这些值来自磁盘上的元数据（用户/项目可写），直接拼进发给模型的指令会构成提示词注入面。
 */
function sanitizeForPrompt(value: string, maxLength = 200): string {
  return value.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/** mcp.json 注册的 MCP server（name + 启动命令） */
export function listMcpServers(): McpServerInfo[] {
  try {
    const file = join(getAgentDir(), "mcp.json");
    if (!existsSync(file)) return [];
    const data: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    const servers = (data as Record<string, unknown>).mcpServers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) return [];
    const out: McpServerInfo[] = [];
    for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
      // 单个条目非法只跳过该条，不拖垮整个列表
      if (!entry || typeof entry !== "object") {
        logger.warn(`mcp.json 条目 ${name} 非对象（已跳过）`);
        continue;
      }
      const command = (entry as Record<string, unknown>).command;
      const args = (entry as Record<string, unknown>).args;
      if (command !== undefined && typeof command !== "string") {
        logger.warn(`mcp.json 条目 ${name} 的 command 非字符串（已跳过）`);
        continue;
      }
      if (args !== undefined && (!Array.isArray(args) || !args.every((a) => typeof a === "string"))) {
        logger.warn(`mcp.json 条目 ${name} 的 args 非字符串数组（已跳过）`);
        continue;
      }
      out.push({
        name,
        command: command ? sanitizeForPrompt(`${command} ${(args ?? []).join(" ")}`.trim(), 160) : "",
      });
    }
    return out;
  } catch (err) {
    logger.warn(`mcp.json 读取失败（视为未配置）：${String(err)}`);
    return [];
  }
}

/** skill 调用指令：拼到用户下一条消息前，让 pi 按该 skill 处理 */
export function skillDirective(info: SkillInfo): string {
  // name/filePath 来自磁盘元数据，清洗防提示词注入（换行截断、超长截断）
  const name = sanitizeForPrompt(info.name, 80);
  const filePath = sanitizeForPrompt(info.filePath);
  return `【skill 指令】请严格按 skill「${name}」处理用户请求：先读取 ${filePath}（及其引用文件），按其说明执行。`;
}

/** MCP 调用指令：让 pi 调用指定 server 的工具处理下一条消息 */
export function mcpDirective(info: McpServerInfo): string {
  const name = sanitizeForPrompt(info.name, 80);
  return `【MCP 指令】请调用 MCP server「${name}」的相应工具处理用户请求（工具名通常带该 server 前缀）；若工具不可用则说明原因。`;
}
