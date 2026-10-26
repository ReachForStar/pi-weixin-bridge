import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { writeFileAtomic } from "./fs-atomic.js";
import { parse, resolve } from "node:path";
import { logger } from "./logger/index.js";
import { ACCOUNT_FILE, STATE_DIR } from "./config.js";
import type { AccountState } from "./ilink/login.js";
import { setTimeout as delay } from "node:timers/promises";

/** 校验 account.json 结构：畸形内容按未登录处理并隔离备份 */
function isValidAccount(value: unknown): value is AccountState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return typeof state.botToken === "string" && state.botToken.length > 0;
}

/** 读取已保存的微信账号凭据；损坏/不可读时 warn 并返回 null（不静默吞错，便于区分“未登录”与“文件损坏”） */
export function loadState(): AccountState | null {
  if (!existsSync(ACCOUNT_FILE)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(ACCOUNT_FILE, "utf8"));
    if (!isValidAccount(parsed)) {
      const backup = `${ACCOUNT_FILE}.corrupt-${Date.now()}`;
      try { renameSync(ACCOUNT_FILE, backup); } catch { /* 隔离失败不阻断 */ }
      logger.warn(`account.json 结构非法（已备份为 ${backup}，视为未登录）`);
      return null;
    }
    return parsed;
  } catch (err) {
    logger.warn(`account.json 读取或解析失败（将视为未登录）：${String(err)}`);
    return null;
  }
}

/** 用户可能误填的系统/共享目录：chmod 成 0700 会影响同机其他用户或系统服务（含其子目录） */
function isUnsafeToHarden(dir: string): boolean {
  const resolved = resolve(dir);
  if (resolved === parse(resolved).root) return true;
  // 前缀匹配：/tmp/pi-state、/home/<user>/xxx 等子目录同样不允许收紧
  return ["/tmp", "/var/tmp", "/usr", "/etc", "/home", "/root", "/var", "/opt"]
    .some((prefix) => resolved === prefix || resolved.startsWith(`${prefix}/`));
}

/** POSIX 下收紧状态目录权限（凭据所在，mkdir 的 mode 受 umask 影响，需显式修正） */
export function hardenStateDir(dir: string = STATE_DIR): void {
  if (process.platform === "win32" || !existsSync(dir)) return;
  if (isUnsafeToHarden(dir)) {
    logger.warn(`状态目录指向系统/共享路径，已跳过权限收紧：${dir}`);
    return;
  }
  try {
    chmodSync(dir, 0o700);
  } catch {
    // 非属主等场景不阻断主流程
  }
}

/** 持久化微信账号凭据；原子写（tmp+rename，进程中途被杀不会留下半截文件）；POSIX 下收紧权限（目录 700 / 文件 600，凭据不可被其他用户读取） */
export function saveState(state: AccountState): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  // 共享原子写：随机名临时文件 + 独占创建 + 0o600，循环写满并 fsync 文件与父目录。
  // 固定名 .tmp 会被本地攻击者预置符号链接，且默认 umask 会让凭据在 rename 前有一段时间是 0664。
  writeFileAtomic(ACCOUNT_FILE, JSON.stringify(state, null, 2), 0o600);
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
    await delay(pollMs, undefined, { signal });
    signal.throwIfAborted();
    const s = loadState();
    if (s?.botToken && (!prev || s.botToken !== prev.botToken)) return s;
  }
}
