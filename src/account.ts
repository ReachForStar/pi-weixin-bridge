import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ACCOUNT_FILE, STATE_DIR } from "./config.js";
import type { AccountState } from "./ilink/login.js";

/** 读取已保存的微信账号凭据 */
export function loadState(): AccountState | null {
  if (!existsSync(ACCOUNT_FILE)) return null;
  try {
    return JSON.parse(readFileSync(ACCOUNT_FILE, "utf8")) as AccountState;
  } catch {
    return null;
  }
}

/** POSIX 下收紧状态目录权限（凭据所在，mkdir 的 mode 受 umask 影响，需显式修正） */
export function hardenStateDir(): void {
  if (process.platform === "win32" || !existsSync(STATE_DIR)) return;
  try {
    chmodSync(STATE_DIR, 0o700);
  } catch {
    // 非属主等场景不阻断主流程
  }
}

/** 持久化微信账号凭据；POSIX 下收紧权限（目录 700 / 文件 600，凭据不可被其他用户读取） */
export function saveState(state: AccountState): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(ACCOUNT_FILE, JSON.stringify(state, null, 2), "utf8");
  if (process.platform !== "win32") {
    hardenStateDir();
    try {
      chmodSync(ACCOUNT_FILE, 0o600);
    } catch {
      // 非属主等场景 chmod 失败不阻断主流程
    }
  }
}

/**
 * 等待账号被重新扫码保存（后台模式重登）：
 * 轮询 account.json，直到出现与 prev 不同的 botToken（prev 为 null 时任意有效账号即可）；
 * 等待期间被 abort（进程退出）则抛错，避免挂起。
 */
export async function waitForAccountChange(
  prev: AccountState | null,
  signal: AbortSignal,
  pollMs = 10_000,
): Promise<AccountState> {
  for (;;) {
    if (signal.aborted) throw new Error("等待重登期间进程已退出");
    // 轮询等待，被 abort（退出信号）时立即唤醒，不睡满 pollMs
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, pollMs);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    const s = loadState();
    if (s?.botToken && (!prev || s.botToken !== prev.botToken)) return s;
  }
}
