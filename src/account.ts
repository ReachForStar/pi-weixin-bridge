import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** 持久化微信账号凭据 */
export function saveState(state: AccountState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(ACCOUNT_FILE, JSON.stringify(state, null, 2), "utf8");
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
    await new Promise((r) => setTimeout(r, pollMs));
    const s = loadState();
    if (s?.botToken && (!prev || s.botToken !== prev.botToken)) return s;
  }
}
