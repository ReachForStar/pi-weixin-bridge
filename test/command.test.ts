import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SlashCommandHandler } from "../src/command.js";

function makeHandler(piOverrides: Record<string, unknown> = {}) {
  const mockPi = {
    resetSession: vi.fn().mockResolvedValue(undefined),
    getModelRef: () => "amax/qwen-3.8-27B",
    listModels: vi.fn().mockResolvedValue("📋 可用模型"),
    switchModel: vi.fn().mockResolvedValue("已切换"),
    sessionCount: () => 2,
    busyCount: () => 1,
    getSessionStats: () => undefined,
    interrupt: vi.fn().mockResolvedValue(false),
    setDirective: vi.fn(),
    reload: vi.fn().mockResolvedValue("重载完成。当前模型：amax/qwen-3.8-27B（无活动会话）"),
    ...piOverrides,
  } as any;
  const handler = new SlashCommandHandler(mockPi, "test-account");
  return { handler, mockPi };
}

const STATS = {
  sessionFile: undefined,
  sessionId: "s1",
  userMessages: 6,
  assistantMessages: 6,
  toolCalls: 8,
  toolResults: 8,
  totalMessages: 12,
  tokens: { input: 1200, output: 340, cacheRead: 5100, cacheWrite: 0, total: 6640 },
  cost: 0.0123,
  contextUsage: { tokens: 16400, contextWindow: 262144, percent: 6.3 },
};

describe("SlashCommandHandler /skill /mcp", () => {
  let home: string;
  let agentDir: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "piwx-cmd-"));
    agentDir = join(home, "agent");
    mkdirSync(join(agentDir, "skills", "demo-skill"), { recursive: true });
    writeFileSync(
      join(agentDir, "skills", "demo-skill", "SKILL.md"),
      "---\nname: demo-skill\ndescription: 演示技能\n---\n\nbody\n",
      "utf8",
    );
    writeFileSync(
      join(agentDir, "mcp.json"),
      JSON.stringify({ mcpServers: { "demo-mcp": { command: "demo", args: ["--flag"] } } }),
      "utf8",
    );
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("PI_WEIXIN_WORKSPACE", join(home, "ws"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it("/skill 无参列出 skill", async () => {
    const { handler } = makeHandler();
    const reply = await handler.handle("/skill", { key: "k" });
    expect(reply).toContain("可用 skill");
    expect(reply).toContain("demo-skill — 演示技能");
  });

  it("/skill <名称> 设置指令；未找到时提示", async () => {
    const { handler, mockPi } = makeHandler();
    const reply = await handler.handle("/skill demo-skill", { key: "k1" });
    expect(reply).toContain("按 skill「demo-skill」处理");
    expect(mockPi.setDirective).toHaveBeenCalledWith("k1", expect.stringContaining("demo-skill"));
    expect(await handler.handle("/skill no-such", { key: "k" })).toContain("未找到 skill");
  });

  it("/mcp 无参列出 server；/mcp <名称> 设置指令", async () => {
    const { handler, mockPi } = makeHandler();
    const list = await handler.handle("/mcp", { key: "k" });
    expect(list).toContain("demo-mcp");
    expect(list).toContain("demo --flag");
    const reply = await handler.handle("/mcp demo-mcp", { key: "k2" });
    expect(reply).toContain("MCP「demo-mcp」");
    expect(mockPi.setDirective).toHaveBeenCalledWith("k2", expect.stringContaining("demo-mcp"));
    expect(await handler.handle("/mcp no-such", { key: "k" })).toContain("未找到 MCP server");
  });
});

describe("SlashCommandHandler", () => {
  it("/help 列出全部命令", async () => {
    const { handler } = makeHandler();
    const reply = await handler.handle("/help", { key: "k" });
    for (const c of ["/status", "/new", "/model", "/usage", "/stop", "/ping", "/reload"]) {
      expect(reply).toContain(c);
    }
  });

  it("/status 返回版本 / 账号 / 模型 / 会话", async () => {
    const { handler } = makeHandler();
    const reply = await handler.handle("/status", { key: "k" });
    expect(reply).toContain("test-account");
    expect(reply).toContain("amax/qwen-3.8-27B");
    expect(reply).toContain("2 个（1 个处理中）");
    expect(reply).toMatch(/版本：\d+\.\d+\.\d+/);
    expect(reply).not.toContain("已知用户");
  });

  it("/new 重置会话", async () => {
    const { handler, mockPi } = makeHandler();
    const reply = await handler.handle("/new", { key: "user-1" });
    expect(mockPi.resetSession).toHaveBeenCalledWith("user-1");
    expect(reply).toContain("新对话");
  });

  it("/model 无参只显示当前模型（无提示行）", async () => {
    const { handler } = makeHandler();
    const reply = await handler.handle("/model", { key: "k" });
    expect(reply).toBe("当前模型：amax/qwen-3.8-27B");
  });

  it("/model list 走 listModels；/model x/y 走 switchModel", async () => {
    const { handler, mockPi } = makeHandler();
    await handler.handle("/model list", { key: "k" });
    expect(mockPi.listModels).toHaveBeenCalled();
    await handler.handle("/model foo/bar", { key: "k" });
    expect(mockPi.switchModel).toHaveBeenCalledWith("foo/bar");
  });

  it("/usage 有会话时返回统计（Token 紧凑格式 + 上下文百分比）", async () => {
    const { handler } = makeHandler({ getSessionStats: () => STATS });
    const reply = await handler.handle("/usage", { key: "k" });
    expect(reply).toContain("用户 6 / 助手 6");
    expect(reply).toContain("工具调用：8 次");
    expect(reply).toContain("1.2k"); // 1200 → k
    expect(reply).toContain("$0.0123");
    expect(reply).toContain("6.3%");
  });

  it("/usage 无会话时提示", async () => {
    const { handler } = makeHandler();
    expect(await handler.handle("/usage", { key: "k" })).toContain("还没有会话");
  });

  it("/stop 有任务时请求中断；无任务时提示", async () => {
    const { handler, mockPi } = makeHandler({ interrupt: vi.fn().mockResolvedValue(true) });
    expect(await handler.handle("/stop", { key: "k" })).toContain("已停止");
    expect(mockPi.interrupt).toHaveBeenCalledWith("k");
    const { handler: h2, mockPi: p2 } = makeHandler();
    expect(await h2.handle("/stop", { key: "k" })).toContain("没有进行中");
    expect(p2.interrupt).toHaveBeenCalled();
  });

  it("/ping 返回存活", async () => {
    const { handler } = makeHandler();
    expect(await handler.handle("/ping", { key: "k" })).toContain("pong");
  });

  it("/reload 走 pi.reload()", async () => {
    const { handler, mockPi } = makeHandler();
    const reply = await handler.handle("/reload", { key: "k" });
    expect(mockPi.reload).toHaveBeenCalled();
    expect(reply).toContain("重载完成");
  });

  it("非斜杠命令返回 null", async () => {
    const { handler } = makeHandler();
    expect(await handler.handle("hello", { key: "k" })).toBeNull();
  });

  it("未知斜杠命令返回 null（交给 pi）", async () => {
    const { handler } = makeHandler();
    expect(await handler.handle("/unknown-cmd", { key: "k" })).toBeNull();
  });
});
