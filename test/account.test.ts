import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 后台重登等待：轮询 account.json，直到 botToken 变化或进程被中断。
// 通过 PI_WEIXIN_STATE_DIR 重定向状态目录，避免污染真实 ~/.pi-weixin-bridge。
describe("waitForAccountChange", () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "acct-"));
    vi.stubEnv("PI_WEIXIN_STATE_DIR", dir);
    vi.resetModules(); // 让 config.ts 以新的 STATE_DIR 重新求值
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("检测到与 prev 不同的 botToken 后返回新账号", async () => {
    const { waitForAccountChange, saveState } = await import("../src/account.js");
    const prev = { botToken: "old", accountId: "a1", baseUrl: "https://x" };
    saveState(prev);
    const controller = new AbortController();
    const promise = waitForAccountChange(prev, controller.signal, 10);
    setTimeout(
      () => saveState({ botToken: "new", accountId: "a1", baseUrl: "https://x" }),
      30,
    );
    const state = await promise;
    expect(state.botToken).toBe("new");
  });

  it("prev 为 null 时任意有效账号即返回", async () => {
    const { waitForAccountChange, saveState } = await import("../src/account.js");
    const controller = new AbortController();
    const promise = waitForAccountChange(null, controller.signal, 10);
    setTimeout(
      () => saveState({ botToken: "first", accountId: "a2", baseUrl: "https://x" }),
      30,
    );
    const state = await promise;
    expect(state.botToken).toBe("first");
  });

  it("等待期间被 abort 时抛错（不挂起）", async () => {
    const { waitForAccountChange } = await import("../src/account.js");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await expect(
      waitForAccountChange(null, controller.signal, 10),
    ).rejects.toThrow();
  });
});

// 凭据权限加固：仅 POSIX 有意义（Windows 靠用户目录 ACL）
describe.skipIf(process.platform === "win32")("saveState 权限加固（POSIX）", () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "piwx-perm-"));
    vi.stubEnv("PI_WEIXIN_STATE_DIR", dir);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("状态目录 700 / 账号文件 600（不受 umask 影响）", async () => {
    // 故意设置宽松 umask，验证 chmod 仍能收紧
    process.umask(0o022);
    const { saveState } = await import("../src/account.js");
    const { ACCOUNT_FILE } = await import("../src/config.js");
    saveState({ botToken: "t", accountId: "a", baseUrl: "https://x" });
    expect(statSync(ACCOUNT_FILE).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
});
