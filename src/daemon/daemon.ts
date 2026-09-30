// 内置后台 daemon 控制端：拉起/停止 supervisor 进程树、PID 与日志管理。
// 零第三方依赖（替代 PM2 硬依赖）：PID/日志全部落在 STATE_DIR，后台入口来自 npm 安装路径。
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  closeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE_DIR } from "../config.js";
import { hardenStateDir } from "../account.js";
import { readProcessId } from "./process-lock.js";
import { setTimeout as delay } from "node:timers/promises";

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

export function readPidOrNull(file: string): number | null {
  return readProcessId(file);
}

export function readRuntimeStatus(): { state: string; pid: number } | undefined {
  const file = join(DAEMON_DIR, "runtime.json");
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as { state: string; pid: number };
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
export async function startDaemon(): Promise<{ ok: boolean; message: string }> {
  const st = daemonStatus();
  if (st.running) {
    const runtime = readRuntimeStatus();
    return { ok: true, message: `守护进程已运行（pid ${st.supervisorPid}），桥接状态：${runtime && runtime.pid === st.bridgePid ? runtime.state : "启动或重启中"}；status 和 daemon logs 查看详情` };
  }
  const instance = readProcessId(join(STATE_DIR, "instance.pid"));
  if (instance && isPidAlive(instance)) return { ok: false, message: `已有桥接实例运行（pid ${instance}），请先停止该实例` };
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
  closeSync(fd);
  let spawnError: Error | undefined;
  child.on("error", (error) => { spawnError = error; });

  // 等 supervisor 启动并写入 supervisor.pid（tsx 加载较慢，上限 10s；进程若已退出则提前失败）
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const s = daemonStatus();
    const runtime = readRuntimeStatus();
    if (s.running && s.bridgePid && runtime?.pid === s.bridgePid) {
      if (runtime.state === "running") return { ok: true, message: `已启动（supervisor pid ${s.supervisorPid}，桥接 pid ${s.bridgePid}），消息循环已启动` };
      if (runtime.state === "waiting-login") return { ok: true, message: "后台已启动，正在等待登录；请运行 pi-weixin-bridge login 扫码" };
    }
    if (spawnError || child.exitCode !== null || child.signalCode !== null) break;
    await delay(100);
  }
  return { ok: false, message: `桥接未就绪${spawnError ? `：${spawnError.message}` : ""}，请查看 ${BRIDGE_LOG_FILE} 和 ${SUPERVISOR_LOG_FILE}；守护进程可能仍在启动或重试` };
}

/** 杀掉 supervisor 及其子进程树 */
export function killProcessTree(pid: number, force = true): void {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(pid), "/t", ...(force ? ["/f"] : [])], { stdio: "ignore", windowsHide: true, timeout: 10_000 });
    if (result.error) throw result.error;
    if (result.status !== 0 && isPidAlive(pid)) throw new Error(`无法停止进程 ${pid}`);
  } else {
    try {
      process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
    } catch {
      try {
        process.kill(pid, force ? "SIGKILL" : "SIGTERM");
      } catch {
        // 已退出
      }
    }
  }
}

/** 停止 daemon：杀进程树并清理残留 PID 文件 */
export async function stopDaemon(): Promise<{ stopped: boolean }> {
  const st = daemonStatus();
  if (!st.running) {
    const orphan = readPidOrNull(BRIDGE_PID_FILE);
    if (orphan && isPidAlive(orphan)) {
      killProcessTree(orphan);
      await delay(100);
      if (isPidAlive(orphan)) throw new Error(`桥接进程 ${orphan} 未能停止，保留 PID 文件`);
      cleanupStalePids();
      return { stopped: true };
    }
    cleanupStalePids();
    return { stopped: false };
  }
  killProcessTree(st.supervisorPid!, process.platform === "win32");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && isPidAlive(st.supervisorPid!)) await delay(100);
  if (isPidAlive(st.supervisorPid!)) killProcessTree(st.supervisorPid!);
  const finalDeadline = Date.now() + 5_000;
  while (Date.now() < finalDeadline && (isPidAlive(st.supervisorPid!) || (st.bridgePid && isPidAlive(st.bridgePid)))) await delay(100);
  if (isPidAlive(st.supervisorPid!) || (st.bridgePid && isPidAlive(st.bridgePid))) throw new Error("后台进程未能停止，保留 PID 文件供排查");
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
