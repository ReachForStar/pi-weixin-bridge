import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

describe("真实 pi 模型配置与安装选择", () => {
  const keys = ["HOME", "USERPROFILE", "PI_CODING_AGENT_DIR", "PI_WEIXIN_STATE_DIR", "PI_WEIXIN_WORKSPACE", "PI_WEIXIN_MODEL"];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  let root: string;
  let configuredModels: typeof import("../src/models.js").configuredModels;
  let wizard: typeof import("../src/wizard.js");
  let config: typeof import("../src/config.js");
  let PiSessionManager: typeof import("../src/pi/sessions.js").PiSessionManager;

  beforeAll(async () => {
    mkdirSync("tmp", { recursive: true });
    root = mkdtempSync(resolve("tmp", "model-check-"));
    process.env.HOME = root;
    process.env.USERPROFILE = root;
    process.env.PI_CODING_AGENT_DIR = join(root, "agent");
    process.env.PI_WEIXIN_STATE_DIR = join(root, "state");
    process.env.PI_WEIXIN_WORKSPACE = join(root, "workspace");
    delete process.env.PI_WEIXIN_MODEL;
    mkdirSync(join(root, "agent"), { recursive: true });
    const builtin = await ModelRuntime.create({ modelsPath: null, authPath: join(root, "agent", "auth.json"), modelsStorePath: join(root, "agent", "models-store.json"), allowModelNetwork: false });
    writeFileSync(join(root, "agent", "models.json"), JSON.stringify({ providers: {
      openai: { baseUrl: builtin.getModels("openai")[0].baseUrl },
      anthropic: { baseUrl: builtin.getModels("anthropic")[0].baseUrl },
    } }), "utf8");
    ({ configuredModels } = await import("../src/models.js"));
    wizard = await import("../src/wizard.js");
    config = await import("../src/config.js");
    ({ PiSessionManager } = await import("../src/pi/sessions.js"));
  });
  afterAll(() => {
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });

  it("仅列 models.json 中的供应方，使用 SDK 实际模型目录", async () => {
    const models = await configuredModels();
    expect([...new Set(models.map((model) => model.provider))]).toEqual(["openai", "anthropic"]);
    expect(models.every((model) => model.ref === model.provider + "/" + model.id)).toBe(true);
    expect(models.length).toBeGreaterThan(2);
  });
  it("未选择默认模型时明确拒绝启动", async () => {
    const manager = new PiSessionManager();
    await expect(manager.init()).rejects.toThrow("尚未选择默认模型");
    manager.dispose();
  });
  it("真实输入流选择供应方和模型，保存默认值并保留已有配置", async () => {
    config.saveSettings({ access: { admins: ["owner"], allowFrom: [] }, budget: { dailyTokens: 1000 } });
    const models = await configuredModels();
    const selected = await wizard.runModelWizard({ interactive: true, input: Readable.from(["2\n1\n"]) });
    expect(selected).toBe(models.find((model) => model.provider === "anthropic")!.ref);
    const settings = config.loadSettings();
    expect(settings.model).toBe(selected);
    expect(settings.budget?.dailyTokens).toBe(1000);
    expect(settings.access?.admins).toEqual(["owner"]);
    expect(JSON.parse(readFileSync(config.CONFIG_FILE, "utf8")).model).toBe(selected);
  });
  it("会话切换持久化且不更改安装默认值或其他会话", async () => {
    const models = await configuredModels();
    const manager = new PiSessionManager();
    const defaultRef = config.loadSettings().model;
    await manager.switchSessionModel("owner", models[0].ref);
    expect(manager.getSessionModelRef("owner")).toBe(models[0].ref);
    expect(manager.getSessionModelRef("other")).toBe("");
    expect(config.loadSettings().model).toBe(defaultRef);
    const { Policy } = await import("../src/features/policy.js");
    expect(new Policy().profile("owner", "owner").model).toBe(models[0].ref);
    await expect(manager.switchSessionModel("owner", "unconfigured/missing")).rejects.toThrow("不在 models.json");
    manager.dispose();
  });
  it("非法供应方编号不保存，非交互模式要求明确默认值", async () => {
    await expect(wizard.runModelWizard({ interactive: true, input: Readable.from(["invalid\n"]) })).rejects.toThrow("供应方编号无效");
    await expect(wizard.runModelWizard({ assumeYes: true })).rejects.toThrow("非交互安装需要");
  });
});
