import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, type Readable } from "node:stream";

// 模拟真实 TTY：流不主动 end，答案逐行延迟写入（与 question 节奏配合）
function answers(...lines: string[]): Readable {
  const p = new PassThrough();
  lines.forEach((line, i) => {
    setTimeout(() => p.write(line + "\n"), 20 * (i + 1));
  });
  return p;
}

// 快速管道输入：所有行在 question 之前一次性到达（回归：不得丢答案）
function instantAnswers(...lines: string[]): Readable {
  const p = new PassThrough();
  p.write(lines.join("\n") + "\n");
  return p;
}

describe("runInstallWizard", () => {
  let home: string;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "piwx-wiz-"));
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

  it("assumeYes：使用默认路径、写 config.json、目录可创建", async () => {
    const { runInstallWizard } = await import("../src/wizard.js");
    const { BOOTSTRAP_DIR } = await import("../src/config.js");
    const choice = await runInstallWizard({ assumeYes: true });
    expect(choice.fromDefaults).toBe(true);
    expect(choice.stateDir).toBe(BOOTSTRAP_DIR);
    // 状态目录已被探针创建
    expect(existsSync(BOOTSTRAP_DIR)).toBe(true);
    // config.json 已写入（默认值省略字段）
    const cfg = JSON.parse(readFileSync(join(BOOTSTRAP_DIR, "config.json"), "utf8"));
    expect(cfg).toEqual({});
  });

  it("交互：自定义路径写入 config.json 且 fromDefaults=false", async () => {
    const { runInstallWizard } = await import("../src/wizard.js");
    const customState = join(home, "my-state");
    const customWs = join(home, "my-ws");
    const choice = await runInstallWizard({
      interactive: true,
      input: answers(customState, customWs),
    });
    expect(choice.fromDefaults).toBe(false);
    expect(choice.stateDir).toBe(customState);
    expect(choice.workspace).toBe(customWs);
    expect(existsSync(customState)).toBe(true);
    expect(existsSync(customWs)).toBe(true);
    const cfg = JSON.parse(
      readFileSync(join(home, ".pi-weixin-bridge", "config.json"), "utf8"),
      "utf8",
    );
    expect(cfg).toEqual({ stateDir: customState, workspace: customWs });
  });

  it("交互：~ 展开为用户主目录", async () => {
    const { runInstallWizard } = await import("../src/wizard.js");
    const choice = await runInstallWizard({
      interactive: true,
      input: answers("~/wiz-state", "~/wiz-ws"),
    });
    expect(choice.stateDir).toBe(join(home, "wiz-state"));
    expect(choice.workspace).toBe(join(home, "wiz-ws"));
  });

  it("快速管道输入：两行先于 question 到达也不丢答案", async () => {
    const { runInstallWizard } = await import("../src/wizard.js");
    const choice = await runInstallWizard({
      interactive: true,
      input: instantAnswers(join(home, "fast-state"), join(home, "fast-ws")),
    });
    expect(choice.stateDir).toBe(join(home, "fast-state"));
    expect(choice.workspace).toBe(join(home, "fast-ws"));
  });

  it("EOF（流结束）时挂起的 question 按空输入结算（回退默认）", async () => {
    const { runInstallWizard } = await import("../src/wizard.js");
    const { WORKSPACE } = await import("../src/config.js");
    // 只给一行，第二问在流结束后才发出 → 应按空输入回退默认
    const p = new PassThrough();
    p.write(join(home, "eof-state") + "\n");
    p.end();
    const choice = await runInstallWizard({ interactive: true, input: p });
    expect(choice.stateDir).toBe(join(home, "eof-state"));
    expect(choice.workspace).toBe(WORKSPACE);
  });

  it("不可写目录：抛错并提示", async () => {
    const { runInstallWizard } = await import("../src/wizard.js");
    // 用文件占位使 mkdir 失败（跨平台构造“不可写目录”）
    const blocker = join(home, "sub");
    writeFileSync(blocker, "x", "utf8");
    const badDir = join(home, "sub", "no-perm");
    await expect(
      runInstallWizard({ interactive: true, input: answers(badDir, join(home, "ws")) }),
    ).rejects.toThrow(/不可写/);
  });

  it("回车（空输入）：回退默认值", async () => {
    const { runInstallWizard } = await import("../src/wizard.js");
    const { BOOTSTRAP_DIR } = await import("../src/config.js");
    const choice = await runInstallWizard({ interactive: true, input: answers("", "") });
    expect(choice.fromDefaults).toBe(true);
    expect(choice.stateDir).toBe(BOOTSTRAP_DIR);
  });
});
