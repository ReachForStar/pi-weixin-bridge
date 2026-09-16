import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

// PiSessionManager 模型管理：默认引用、切换（含持久化）、未知模型、列表。
// 注入 fake ModelRuntime，不触碰真实 ~/.pi/agent 与网络。
function fakeRuntime(models: Array<{ provider: string; id: string; name: string }>) {
  const map = new Map(models.map((m) => [`${m.provider}/${m.id}`, m]));
  return {
    getModel: (provider: string, modelId: string) => map.get(`${provider}/${modelId}`),
    getAvailable: async () => models,
    getModels: () => models,
    refresh: async () => ({}),
  } as unknown as ModelRuntime;
}

const MODELS = [
  { provider: "amax", id: "qwen-3.8-27B", name: "Qwen3.8-27B" },
  { provider: "qwen38-vllm", id: "Qwen3.8-27B", name: "Qwen3.8-27B" },
  // 内置目录的模型：未写入 models.json，不应出现在 /model list
  { provider: "deepseek", id: "deepseek-chat", name: "DeepSeek Chat" },
];

describe("PiSessionManager 模型管理", () => {
  let home: string;
  let agentDir: string;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "piwx-model-"));
    agentDir = join(home, "agent");
    mkdirSync(agentDir, { recursive: true });
    // 假 models.json：只有 amax / qwen38-vllm 两个注册 provider
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify({ providers: { amax: {}, "qwen38-vllm": {} } }),
      "utf8",
    );
    vi.stubEnv("PI_WEIXIN_STATE_DIR", "");
    vi.stubEnv("PI_WEIXIN_WORKSPACE", "");
    vi.stubEnv("PI_WEIXIN_MODEL", "");
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("HOME", home);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  async function makeManager(runtime: unknown) {
    // 动态导入：确保 config 模块在 env stub 之后加载（BOOTSTRAP_DIR 指向假 home）
    const { PiSessionManager } = await import("../src/pi/sessions.js");
    const mgr = new PiSessionManager();
    await mgr.init(runtime as ModelRuntime);
    return mgr;
  }

  it("默认模型引用为内置 amax/qwen-3.8-27B", async () => {
    const mgr = await makeManager(fakeRuntime(MODELS));
    expect(mgr.getModelRef()).toBe("amax/qwen-3.8-27B");
  });

  it("switchModel：切换成功、更新引用、持久化到 config.json", async () => {
    const mgr = await makeManager(fakeRuntime(MODELS));
    const msg = await mgr.switchModel("qwen38-vllm/Qwen3.8-27B");
    expect(msg).toContain("qwen38-vllm/Qwen3.8-27B");
    expect(mgr.getModelRef()).toBe("qwen38-vllm/Qwen3.8-27B");
    const cfg = JSON.parse(readFileSync(join(home, ".pi-weixin-bridge", "config.json"), "utf8"));
    expect(cfg.model).toBe("qwen38-vllm/Qwen3.8-27B");
  });

  it("switchModel：未知模型 / 格式错误时返回提示", async () => {
    const mgr = await makeManager(fakeRuntime(MODELS));
    expect(await mgr.switchModel("unknown/unknown")).toContain("未找到模型");
    expect(await mgr.switchModel("noslash")).toContain("未找到模型");
    expect(mgr.getModelRef()).toBe("amax/qwen-3.8-27B"); // 未切换
  });

  it("listModels：只列 provider/modelId（无名称行），并标记当前", async () => {
    const mgr = await makeManager(fakeRuntime(MODELS));
    const list = await mgr.listModels();
    expect(list).toContain("📋 可用模型（2）");
    expect(list).toContain("1. amax/qwen-3.8-27B ✓ 当前");
    expect(list).toContain("2. qwen38-vllm/Qwen3.8-27B");
    expect(list).not.toContain("Qwen3.8-27B\n   "); // 无名称行
    expect(list).not.toContain("DeepSeek Chat"); // 未注册的内置 provider 被过滤，也不带名称
    expect(list).not.toContain("/model <provider/modelId>"); // 不带切换提示行
  });

  it("listModels：无 models.json 时回退到有鉴权的模型", async () => {
    rmSync(join(agentDir, "models.json"), { force: true });
    const mgr = await makeManager(fakeRuntime(MODELS));
    const list = await mgr.listModels();
    expect(list).toContain("amax/qwen-3.8-27B");
    expect(list).toContain("deepseek-chat"); // 回退路径不过滤
  });

  it("一次性指令：设置后仅消费一次（/skill、/mcp 用）", async () => {
    const mgr = await makeManager(fakeRuntime(MODELS));
    mgr.setDirective("k", "【skill 指令】…");
    expect(mgr.consumeDirective("k")).toBe("【skill 指令】…");
    expect(mgr.consumeDirective("k")).toBeUndefined(); // 一次性
    expect(mgr.consumeDirective("other")).toBeUndefined();
  });

  it("reload：无会话时报告当前模型；模型未注册时提示回退", async () => {
    const mgr = await makeManager(fakeRuntime(MODELS));
    const r1 = await mgr.reload();
    expect(r1).toContain("重载完成");
    expect(r1).toContain("无活动会话");

    // 未注册的模型引用
    const { PiSessionManager } = await import("../src/pi/sessions.js");
    const mgr2 = new PiSessionManager();
    await mgr2.init(fakeRuntime(MODELS) as ModelRuntime);
    // 通过 switchModel 切到一个随后被“注销”的模型不可行，改用未知引用直接验证 resolve 失败路径：
    // 这里用 listModels 的运行时直接构造：把 modelRef 设为未注册值
    (mgr2 as unknown as { modelRef: string }).modelRef = "ghost/model";
    const r2 = await mgr2.reload();
    expect(r2).toContain("未在 pi 配置中注册");
  });

  it("listModels：无模型时提示", async () => {
    const mgr = await makeManager(fakeRuntime([]));
    expect(await mgr.listModels()).toContain("没有可用模型");
  });
});
