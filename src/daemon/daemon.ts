// 内置后台 daemon 控制端：拉起/停止 supervisor 进程树、PID 与日志管理。
// 零第三方依赖（替代 PM2 硬依赖）：PID/日志全部落在 STATE_DIR，npx 临时目录被清理也不受影响。
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE_DIR } from "../config.js";
import { hardenStateDir } from "../account.js";

/** 包根目录（src/daemon 的上两级） */
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** 桥接服务入口（bin 包装器，经 tsx 运行 TS 源码，免构建） */
export const BIN_PATH = join(PKG_ROOT, "bin", "pi-weixin-bridge.js");

/** daemon 状态与日志目录（~/.pi-weixin-bridge/daemon/） */
export const DAEMON_DIR = join(STATE_DIR, "daemon");
export const SUPERVISOR_PID_FILE = join(DAEMON_DIR, "supervisor.pid");
export const BRIDGE_PID_FILE = join(DAEMON_DIR, "bridge.pid");
export const BRIDGE_LOG_FILE = join(DAEMON_DIR, "bridge.log");
export const SUPERVISOR_LOG_FILE = join(DAEMON_DIR, "supervisor.log");

export const BASE_BACKOFF_MS = 3_000;
export const MAX_BACKOFF_MS = 60_000;

/** 崩溃重启退避：翻倍递增、上限 60s；子进程存活超过 60s 说明不是崩溃循环，重置退避 */
export function nextBackoffMs(prevMs: number, childUptimeMs: number): number {
  if (childUptimeMs > 60_000) return BASE_BACKOFF_MS;
  return Math.min(prevMs * 2, MAX_BACKOFF_MS);
}

/** 探测 PID 是否存活：signal 0 不发信号只查存在性；Windows 上 EPERM 表示进程存在但无权发信号 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function readPidOrNull(file: string): number | null {
  if (!existsSync(file)) return null;
  const n = Number.parseInt(readFileSync(file, "utf8").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface DaemonStatus {
  running: boolean;
  supervisorPid?: number;
  bridgePid?: number;
}

/** 崩溃重启次数（supervisor 每次启动归零、每次崩溃重启递增；无记录为 0） */
export function readRestartCount(daemonDir: string = DAEMON_DIR): number {
  try {
    const n = Number.parseInt(readFileSync(join(daemonDir, "restarts.count"), "utf8").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function daemonStatus(): DaemonStatus {
  const supervisorPid = readPidOrNull(SUPERVISOR_PID_FILE);
  const running = supervisorPid !== null && isPidAlive(supervisorPid);
  if (!running) return { running: false };
  const bridgePid = readPidOrNull(BRIDGE_PID_FILE);
  return {
    running: true,
    supervisorPid,
    bridgePid: bridgePid !== null && isPidAlive(bridgePid) ? bridgePid : undefined,
  };
}

/**
 * 拉起 supervisor（后台常驻）：detached + windowsHide，stdio 全部重定向到 supervisor.log。
 * POSIX 上 detached 使其成为进程组组长，stop 时可整组 kill；Windows 上用 taskkill /t 杀树。
 */
export function startDaemon(): { ok: boolean; message: string } {
  const st = daemonStatus();
  if (st.running) {
    return { ok: true, message: `已在运行（supervisor pid ${st.supervisorPid}），无需重复启动` };
  }
  if (!existsSync(BIN_PATH)) {
    return { ok: false, message: `未找到入口 ${BIN_PATH}` };
  }
  mkdirSync(DAEMON_DIR, { recursive: true });
  hardenStateDir(); // 凭据所在目录，POSIX 下收紧为 700
  const fd = openSync(SUPERVISOR_LOG_FILE, "a");
  const child = spawn(process.execPath, [BIN_PATH, "daemon", "supervise"], {
    cwd: PKG_ROOT,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  child.on("error", () => {
    // spawn 失败（如 node 不存在）时避免未处理的 error 事件
  });

  // 等 supervisor 启动并写入 supervisor.pid（tsx 加载较慢，上限 10s；进程若已退出则提前失败）
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const s = daemonStatus();
    if (s.running) return { ok: true, message: `已启动（supervisor pid ${s.supervisorPid}）` };
    if (child.exitCode !== null) break;
    sleepMs(100);
  }
  return { ok: false, message: `启动失败，请查看 ${SUPERVISOR_LOG_FILE}` };
}

/** 杀掉 supervisor 及其子进程树 */
function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-pid, "SIGTERM"); // 进程组（supervisor 是组长）
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // 已退出
      }
    }
  }
}

/** 停止 daemon：杀进程树并清理残留 PID 文件 */
export function stopDaemon(): { stopped: boolean } {
  const st = daemonStatus();
  if (!st.running) {
    cleanupStalePids();
    return { stopped: false };
  }
  killProcessTree(st.supervisorPid!);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && isPidAlive(st.supervisorPid!)) sleepMs(100);
  if (isPidAlive(st.supervisorPid!)) killProcessTree(st.supervisorPid!);
  cleanupStalePids();
  return { stopped: true };
}

function cleanupStalePids(): void {
  for (const file of [SUPERVISOR_PID_FILE, BRIDGE_PID_FILE]) {
    const pid = readPidOrNull(file);
    if (pid === null || !isPidAlive(pid)) rmSync(file, { force: true });
  }
}

/** 取日志末尾 n 行（文件不存在返回空串） */
export function tailLog(file: string, n: number): string {
  if (!existsSync(file)) return "";
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  return lines.slice(-n).join("\n");
}
