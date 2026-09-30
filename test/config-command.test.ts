import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const execute = promisify(execFile);

describe("真实配置 CLI", () => {
  let root: string;
  let configFile: string;
  let model: string;
  let env: NodeJS.ProcessEnv;
  const bin = resolve("bin/pi-weixin-bridge.js");
  async function cli(...args: string[]) {
    return execute(process.execPath, [bin, ...args], { env, timeout: 30_000 });
  }
  const saved = () => JSON.parse(readFileSync(configFile, "utf8"));

  beforeAll(async () => {
    mkdirSync("tmp", { recursive: true });
    root = mkdtempSync(resolve("tmp", "config-cli-"));
    const agent = join(root, "agent");
    mkdirSync(agent, { recursive: true });
    env = { ...process.env, HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: agent,
      PI_WEIXIN_STATE_DIR: join(root, "state"), PI_WEIXIN_WORKSPACE: join(root, "workspace"), PI_WEIXIN_MODEL: "" };
    const runtime = await ModelRuntime.create({ modelsPath: null, authPath: join(agent, "auth.json"), modelsStorePath: join(agent, "models-store.json"), allowModelNetwork: false });
    const actual = runtime.getModels("openai")[0];
    model = `openai/${actual.id}`;
    writeFileSync(join(agent, "models.json"), JSON.stringify({ providers: { openai: { baseUrl: actual.baseUrl } } }), "utf8");
    configFile = join(root, ".pi-weixin-bridge", "config.json");
  });
  afterAll(async () => { await cli("daemon", "stop"); });

  it("真实 SDK 模型目录选择并保留兄弟配置，环境变量覆盖可见", async () => {
    expect((await cli("config", "models")).stdout).toContain(model);
    await cli("config", "set", "budget.dailyTokens", "100000");
    await cli("config", "model", model);
    expect(saved()).toMatchObject({ model, budget: { dailyTokens: 100000 } });
    const output = JSON.parse((await cli("config", "show")).stdout);
    expect(output.effective.workspace).toBe(env.PI_WEIXIN_WORKSPACE);
    expect(output.saved.model).toBe(model);
    expect(output.overrides.PI_WEIXIN_WORKSPACE).toBe(env.PI_WEIXIN_WORKSPACE);
  }, 30_000);

  it("无效模型、JSON、权限、时区、预算及未知配置项不改写文件", async () => {
    const before = readFileSync(configFile, "utf8");
    for (const args of [
      ["model", "0"], ["set", "model", "openai/"], ["set", "access.admins", "{"],
      ["set", "access.permission", "invalid"], ["set", "budget.timeZone", "invalid"],
      ["set", "budget.dailyTokens", "1.5"], ["set", "budget.dailyCost", "0"],
      ["set", "maxFileBytes", "-1"], ["set", "__proto__", "{}"], ["set", "projects", "[]"],
    ]) {
      await expect(cli("config", ...args)).rejects.toThrow();
      expect(readFileSync(configFile, "utf8")).toBe(before);
    }
  }, 60_000);

  it("白名单、预算嵌套修改和清除不破坏其他字段", async () => {
    await cli("config", "set", "access.admins", JSON.stringify(["owner"]));
    await cli("config", "set", "access.allowFrom", JSON.stringify(["reader"]));
    await cli("config", "set", "budget.timeZone", "Asia/Shanghai");
    await cli("config", "unset", "access.allowFrom");
    await cli("config", "unset", "budget.dailyTokens");
    expect(saved()).toMatchObject({ model, access: { admins: ["owner"], allowFrom: [], permission: "guarded" }, budget: { timeZone: "Asia/Shanghai" } });
    expect((await cli("config", "get", "budget.dailyTokens")).stdout.trim()).toBe("null");
  }, 30_000);

  it("真实目录解析、项目模型验证与配置原子替换", async () => {
    await cli("config", "set", "workspace", join(root, "working directory"));
    const projects = { research: { workspace: join(root, "research"), model, permission: "read-only" } };
    await cli("config", "set", "projects", JSON.stringify(projects));
    expect(saved().projects).toEqual(projects);
    const before = readFileSync(configFile, "utf8");
    await expect(cli("config", "set", "workspace", configFile)).rejects.toThrow();
    await expect(cli("config", "set", "projects", JSON.stringify({ default: projects.research }))).rejects.toThrow();
    expect(readFileSync(configFile, "utf8")).toBe(before);
    expect(saved().workspace).toBe(join(root, "working directory"));
  }, 30_000);

  it("真实后台运行期间拒绝修改路径，停止后允许保存", async () => {
    await cli("daemon", "start");
    try {
      const before = readFileSync(configFile, "utf8");
      await expect(cli("config", "set", "stateDir", join(root, "new-state"))).rejects.toThrow("修改路径前");
      expect(readFileSync(configFile, "utf8")).toBe(before);
    } finally { await cli("daemon", "stop"); }
    await cli("config", "set", "stateDir", join(root, "new-state"));
    expect(saved().stateDir).toBe(join(root, "new-state"));
  }, 45_000);

  it("帮助和非交互查看不触发扫码或启动服务", async () => {
    expect((await cli("config", "--help")).stdout).toContain("config unset");
    expect((await cli("help")).stdout).toContain("config");
    expect((await cli("config")).stdout).toContain("saved");
    await expect(cli("config", "model")).rejects.toThrow("非交互模式");
  }, 30_000);
});
