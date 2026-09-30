import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ModelRuntime, type AgentSession } from "@earendil-works/pi-coding-agent";

describe("真实 SDK 工具权限与导出", () => {
  const keys = ["HOME", "USERPROFILE", "PI_WEIXIN_STATE_DIR", "PI_WEIXIN_WORKSPACE", "PI_WEIXIN_MODEL", "PI_CODING_AGENT_DIR"];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  let root: string;
  let ref: string;
  let PiSessionManager: typeof import("../src/pi/sessions.js").PiSessionManager;
  beforeAll(async () => {
    mkdirSync("tmp", { recursive: true });
    root = mkdtempSync(resolve("tmp", "tool-check-"));
    const agent = join(root, "agent");
    mkdirSync(agent, { recursive: true });
    const catalog = await ModelRuntime.create({ modelsPath: null, authPath: join(agent, "auth.json"), modelsStorePath: join(agent, "models-store.json"), allowModelNetwork: false });
    const model = catalog.getModels("openai")[0];
    ref = model.provider + "/" + model.id;
    writeFileSync(join(agent, "models.json"), JSON.stringify({ providers: { openai: { baseUrl: model.baseUrl } } }), "utf8");
    process.env.HOME = root; process.env.USERPROFILE = root;
    process.env.PI_CODING_AGENT_DIR = agent;
    process.env.PI_WEIXIN_STATE_DIR = join(root, "state");
    process.env.PI_WEIXIN_WORKSPACE = join(root, "workspace");
    process.env.PI_WEIXIN_MODEL = ref;
    ({ PiSessionManager } = await import("../src/pi/sessions.js"));
  });
  afterAll(() => {
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  async function session(permission: "read-only" | "guarded" | "full") {
    const manager = new PiSessionManager();
    await manager.init();
    manager.configure(permission, { workspace: join(root, permission), model: ref, permission });
    const sdk = await (manager as unknown as { getOrCreate(key: string): Promise<AgentSession> }).getOrCreate(permission);
    return { manager, sdk };
  }
  it("只读工具名单与实际调用拦截阻止写入和越界读取", async () => {
    const { manager, sdk } = await session("read-only");
    try {
      expect(sdk.getActiveToolNames()).not.toContain("bash");
      expect(sdk.getActiveToolNames()).not.toContain("write");
      const write = await sdk.extensionRunner.emitToolCall({ type: "tool_call", toolCallId: "permission-check", toolName: "write", input: { path: "LICENSE", content: readFileSync("LICENSE", "utf8") } });
      expect(write?.block).toBe(true);
      const outside = await sdk.extensionRunner.emitToolCall({ type: "tool_call", toolCallId: "path-check", toolName: "read", input: { path: resolve("LICENSE") } });
      expect(outside?.block).toBe(true);
    } finally { manager.dispose(); }
  });
  it("需要确认的工具在没有回复上下文时拒绝执行", async () => {
    const { manager, sdk } = await session("guarded");
    try {
      const result = await sdk.extensionRunner.emitToolCall({ type: "tool_call", toolCallId: "guard-check", toolName: "write", input: { path: "LICENSE", content: readFileSync("LICENSE", "utf8") } });
      expect(result?.block).toBe(true);
      expect(result?.reason).toContain("确认");
    } finally { manager.dispose(); }
  });
  it("导出 SDK HTML 文件，保留原始会话编号", async () => {
    const { manager, sdk } = await session("full");
    try {
      const original = sdk.sessionManager.getSessionId();
      const path = await manager.exportHistory("full");
      expect(readFileSync(path, "utf8")).toContain("<!DOCTYPE html>");
      expect(sdk.sessionManager.getSessionId()).toBe(original);
    } finally { manager.dispose(); }
  });
  it("白名单与只读角色阻止越权，损坏访问配置拒绝读取", async () => {
    const { saveSettings, CONFIG_FILE, loadSettings } = await import("../src/config.js");
    const { Policy } = await import("../src/features/policy.js");
    saveSettings({ access: { admins: ["owner"], allowFrom: ["reader"], permission: "guarded" },
      projects: { reports: { workspace: join(root, "reports"), permission: "full" } } });
    const policy = new Policy();
    expect(policy.identity("outsider").allowed).toBe(false);
    expect(policy.identity("owner").permission).toBe("guarded");
    policy.select("reader", "reports");
    expect(policy.profile("reader", "reader").permission).toBe("read-only");
    const settings = loadSettings();
    writeFileSync(CONFIG_FILE, JSON.stringify({ ...settings, access: null }), "utf8");
    expect(loadSettings).toThrow("config.json 无法读取");
    writeFileSync(CONFIG_FILE, JSON.stringify(settings), "utf8");
    saveSettings({ projects: {} });
    expect(() => policy.profile("reader", "reader")).toThrow("已从配置中移除");
    policy.select("reader", "default");
    expect(policy.profile("reader", "reader").name).toBe("default");
  });
  it("日用量状态保存未知次数，累计已报告部分并限制后续请求", async () => {
    const { saveSettings } = await import("../src/config.js");
    const { UsageLedger } = await import("../src/features/usage.js");
    saveSettings({ budget: { dailyTokens: 1, timeZone: "Asia/Shanghai" } });
    const ledger = new UsageLedger(join(root, "budget-state"));
    ledger.add("owner", 0, 0, false);
    expect(ledger.today("owner").unknown).toBe(1);
    ledger.check("owner");
    ledger.add("owner", 1, 0, false);
    expect(new UsageLedger(join(root, "budget-state")).today("owner").tokens).toBe(1);
    expect(() => ledger.check("owner")).toThrow("达到预算");
    expect(() => ledger.check("other")).not.toThrow();
    saveSettings({ budget: undefined });
  });
});
