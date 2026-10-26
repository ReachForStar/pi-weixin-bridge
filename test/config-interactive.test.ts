import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

describe("配置交互输入流", () => {
  const keys = ["HOME", "USERPROFILE", "PI_CODING_AGENT_DIR", "PI_WEIXIN_STATE_DIR", "PI_WEIXIN_WORKSPACE", "PI_WEIXIN_MODEL"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  let command: typeof import("../src/config-command.js");
  let config: typeof import("../src/config.js");
  let models: Awaited<ReturnType<typeof import("../src/models.js").configuredModels>>;
  beforeAll(async () => {
    mkdirSync("tmp", { recursive: true });
    const root = mkdtempSync(resolve("tmp", "config-input-"));
    process.env.HOME = root;
    process.env.USERPROFILE = root;
    process.env.PI_CODING_AGENT_DIR = join(root, "agent");
    process.env.PI_WEIXIN_STATE_DIR = join(root, "state");
    process.env.PI_WEIXIN_WORKSPACE = join(root, "workspace");
    delete process.env.PI_WEIXIN_MODEL;
    mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
    const runtime = await ModelRuntime.create({ modelsPath: null, authPath: join(root, "auth.json"), modelsStorePath: join(root, "models-store.json"), allowModelNetwork: false });
    writeFileSync(join(process.env.PI_CODING_AGENT_DIR, "models.json"), JSON.stringify({ providers: { openai: { baseUrl: runtime.getModels("openai")[0].baseUrl } } }), "utf8");
    command = await import("../src/config-command.js");
    config = await import("../src/config.js");
    models = await (await import("../src/models.js")).configuredModels();
  });
  afterAll(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

  it("菜单与供应方/模型的快速输入全部消费后保存真实模型", async () => {
    await command.runConfigCommand([], { interactive: true, input: Readable.from(["1\n1\n1\n"]) });
    expect(config.loadSettings().model).toBe(models[0].ref);
  });
  it("单独模型选择遇到 EOF 不改写配置", async () => {
    const before = readFileSync(config.CONFIG_FILE, "utf8");
    await expect(command.runConfigCommand(["model"], { interactive: true, input: Readable.from(["1\n"]) })).rejects.toThrow("模型编号无效");
    expect(readFileSync(config.CONFIG_FILE, "utf8")).toBe(before);
  });
  it("非模型配置输入保存，空输入取消并保留原值", async () => {
    await command.runConfigCommand([], { interactive: true, input: Readable.from(["7\n100000\n"]) });
    expect(config.loadSettings().budget?.dailyTokens).toBe(100000);
    const before = readFileSync(config.CONFIG_FILE, "utf8");
    await command.runConfigCommand([], { interactive: true, input: Readable.from(["7\n\n"]) });
    expect(readFileSync(config.CONFIG_FILE, "utf8")).toBe(before);
  });
});
