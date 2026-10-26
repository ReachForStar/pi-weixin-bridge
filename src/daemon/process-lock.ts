import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { logger } from "../logger/index.js";
import { formatPidFile, matchesStartTime, parsePidFile } from "./pid-identity.js";

export function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** 读取 PID 文件的完整记录（含启动时间，用于识别 PID 复用） */
export function readPidStamp(file: string): { pid: number; startTime?: string } | null {
  if (!existsSync(file)) return null;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed = parsePidFile(text);
  if (!parsed) {
    logger.warn(`进程锁内容非法（按无锁处理）：${file}`);
    return null;
  }
  return parsed;
}

/**
 * 读取进程锁 PID。内容非法（空文件/半写/"0"/非数字）一律视为「无锁」并告警，
 * 只有真正的 I/O 错误才抛出——否则一个损坏的 pid 文件会让 status/stop/start 全部失效，
 * 连 daemon stop 都无法自救，用户只能手工删文件。
 */
export function readProcessId(file: string): number | null {
  return readPidStamp(file)?.pid ?? null;
}

/** 判断 PID 文件记录的进程是否仍存活且身份一致（PID 被复用时视为已死） */
export function pidIsOurs(pid: number, startTime?: string): boolean {
  if (!processExists(pid)) return false;
  return matchesStartTime(pid, startTime) !== "mismatch";
}

/** 回收独占文件标记：内容 PID 已死或文件损坏则视为陈旧，可安全删除 */
function reclaimIsStale(reclaim: string): boolean {
  const stamp = readPidStamp(reclaim);
  return stamp === null || !pidIsOurs(stamp.pid, stamp.startTime);
}

export function acquireProcessLock(file: string): () => void {
  const write = () => writeFileSync(file, formatPidFile(process.pid), { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { write(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const stamp = readPidStamp(file);
    if (stamp && pidIsOurs(stamp.pid, stamp.startTime)) throw new Error(`已有进程运行（pid ${stamp.pid}）`);
    // 回收旧锁也必须独占，并在取得回收权后重读，避免删除其他启动者的新锁。
    const reclaim = `${file}.reclaim`;
    try {
      writeFileSync(reclaim, formatPidFile(process.pid), { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (reclaimError) {
      if ((reclaimError as NodeJS.ErrnoException).code !== "EEXIST") throw reclaimError;
      // 上次进程在「已建 reclaim、未删除」之间被强杀会留下永久残留，此后永远无法启动。
      // 残留文件的持有者已死则回收，否则说明另一启动者正在回收中。
      if (!reclaimIsStale(reclaim)) throw new Error(`另一启动者正在回收旧锁（${reclaim}）`);
      unlinkSync(reclaim);
      writeFileSync(reclaim, formatPidFile(process.pid), { encoding: "utf8", flag: "wx", mode: 0o600 });
    }
    try {
      const current = readPidStamp(file);
      if (current && pidIsOurs(current.pid, current.startTime)) throw new Error(`已有进程运行（pid ${current.pid}）`);
      if (existsSync(file)) unlinkSync(file);
      write();
    } finally {
      try { unlinkSync(reclaim); } catch { /* 已被他人回收 */ }
    }
  }
  return () => {
    if (readProcessId(file) === process.pid) unlinkSync(file);
  };
}
