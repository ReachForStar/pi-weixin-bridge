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

/** mcp.json 注册的 MCP server（name + 启动命令） */
export function listMcpServers(): McpServerInfo[] {
  try {
    const file = join(getAgentDir(), "mcp.json");
    if (!existsSync(file)) return [];
    const data = JSON.parse(readFileSync(file, "utf8")) as {
      mcpServers?: Record<string, { command?: string; args?: string[] }>;
    };
    return Object.entries(data.mcpServers ?? {}).map(([name, c]) => ({
      name,
      command: c.command ? `${c.command} ${(c.args ?? []).join(" ")}`.trim() : "",
    }));
  } catch (err) {
    logger.warn(`mcp.json 读取失败（视为未配置）：${String(err)}`);
    return [];
  }
}

/** skill 调用指令：拼到用户下一条消息前，让 pi 按该 skill 处理 */
export function skillDirective(info: SkillInfo): string {
  return `【skill 指令】请严格按 skill「${info.name}」处理用户请求：先读取 ${info.filePath}（及其引用文件），按其说明执行。`;
}

/** MCP 调用指令：让 pi 调用指定 server 的工具处理下一条消息 */
export function mcpDirective(info: McpServerInfo): string {
  return `【MCP 指令】请调用 MCP server「${info.name}」的相应工具处理用户请求（工具名通常带该 server 前缀）；若工具不可用则说明原因。`;
}
