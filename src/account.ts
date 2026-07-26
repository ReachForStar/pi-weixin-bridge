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
