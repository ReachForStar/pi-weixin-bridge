import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 配置解析：环境变量 > config.json > 平台默认。
// 通过重定向 HOME/USERPROFILE 隔离引导目录（~/.pi-weixin-bridge/config.json）。
describe("config 路径解析", () => {
  let home: string;
  const envKeys = ["PI_WEIXIN_STATE_DIR", "PI_WEIXIN_WORKSPACE", "USERPROFILE", "HOME"];

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "piwx-home-"));
    vi.stubEnv("PI_WEIXIN_STATE_DIR", "");
    vi.stubEnv("PI_WEIXIN_WORKSPACE", "");
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("HOME", home);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it("默认：状态目录为引导目录，workspace 为平台默认", async () => {
    const { STATE_DIR, WORKSPACE, BOOTSTRAP_DIR } = await import("../src/config.js");
    expect(STATE_DIR).toBe(BOOTSTRAP_DIR);
    expect(STATE_DIR).toBe(join(home, ".pi-weixin-bridge"));
    if (process.platform === "win32") {
      expect(WORKSPACE).toBe("D:\\pi_weixin_project");
    } else {
      expect(WORKSPACE).toBe(join(home, "pi-weixin-project"));
    }
  });

  it("config.json 生效（无环境变量时）", async () => {
    const bootstrap = join(home, ".pi-weixin-bridge");
    rmSync(bootstrap, { recursive: true, force: true });
    mkdirSync(bootstrap, { recursive: true });
    writeFileSync(
      join(bootstrap, "config.json"),
      JSON.stringify({ stateDir: join(home, "custom-state"), workspace: join(home, "custom-ws") }),
      "utf8",
    );
    vi.resetModules();
    const { STATE_DIR, WORKSPACE } = await import("../src/config.js");
    expect(STATE_DIR).toBe(join(home, "custom-state"));
    expect(WORKSPACE).toBe(join(home, "custom-ws"));
  });

  it("环境变量优先于 config.json", async () => {
    const bootstrap = join(home, ".pi-weixin-bridge");
    mkdirSync(bootstrap, { recursive: true });
    writeFileSync(
      join(bootstrap, "config.json"),
      JSON.stringify({ stateDir: join(home, "custom-state") }),
      "utf8",
    );
    vi.stubEnv("PI_WEIXIN_STATE_DIR", join(home, "env-state"));
    vi.resetModules();
    const { STATE_DIR } = await import("../src/config.js");
    expect(STATE_DIR).toBe(join(home, "env-state"));
  });

  it("config.json 损坏时回退默认（不抛错）", async () => {
    const bootstrap = join(home, ".pi-weixin-bridge");
    mkdirSync(bootstrap, { recursive: true });
    writeFileSync(join(bootstrap, "config.json"), "{not json", "utf8");
    vi.resetModules();
    const { STATE_DIR, BOOTSTRAP_DIR } = await import("../src/config.js");
    expect(STATE_DIR).toBe(BOOTSTRAP_DIR);
  });

  it("defaultWorkspace 按平台取值", async () => {
    const { defaultWorkspace } = await import("../src/config.js");
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    try {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      expect(defaultWorkspace()).toBe("D:\\pi_weixin_project");
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      expect(defaultWorkspace()).toBe(join(home, "pi-weixin-project"));
    } finally {
      Object.defineProperty(process, "platform", original!);
    }
  });

  it("resolveUserPath：~ 展开 / 相对转绝对", async () => {
    const { resolveUserPath } = await import("../src/config.js");
    expect(resolveUserPath("~")).toBe(home);
    expect(resolveUserPath("~/data")).toBe(join(home, "data"));
    expect(resolveUserPath("relative/dir").endsWith(join("relative", "dir"))).toBe(true);
    const abs = join(home, "abs");
    expect(resolveUserPath(abs)).toBe(abs);
    expect(existsSync(join(home, "data"))).toBe(false); // 纯解析，不创建目录
  });

  it("MODEL_REF：默认 > config.json > 环境变量优先", async () => {
    const { MODEL_REF } = await import("../src/config.js");
    expect(MODEL_REF).toBe("amax/qwen-3.8-27B"); // 内置默认

    const bootstrap = join(home, ".pi-weixin-bridge");
    mkdirSync(bootstrap, { recursive: true });
    writeFileSync(join(bootstrap, "config.json"), JSON.stringify({ model: "custom/m1" }), "utf8");
    vi.resetModules();
    expect((await import("../src/config.js")).MODEL_REF).toBe("custom/m1");

    vi.stubEnv("PI_WEIXIN_MODEL", "env/m2");
    vi.resetModules();
    expect((await import("../src/config.js")).MODEL_REF).toBe("env/m2");
  });

  it("saveSettings：合并写入，保留其他字段", async () => {
    const { saveSettings, CONFIG_FILE } = await import("../src/config.js");
    saveSettings({ model: "a/b" });
    saveSettings({ stateDir: join(home, "st"), workspace: join(home, "ws") });
    const cfg = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    expect(cfg).toEqual({ model: "a/b", stateDir: join(home, "st"), workspace: join(home, "ws") });
  });
});
