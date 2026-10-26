import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { logger } from "../logger/index.js";
import { captureStartTime, matchesStartTime, parsePidFile, readStartTime, startTimeFile, type PidStamp } from "./pid-identity.js";

export function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** 内容为空/半写的锁文件：`writeFileSync(flag:"wx")` 是先 open 再写字节，存在可观测的空窗 */
function looksHalfWritten(text: string): boolean {
  return text.trim().length === 0;
}

/**
 * 读取 PID 文件记录（pid 来自纯数字锁文件，启动时间来自旁路文件）。
 * 内容非法时返回 null（调用方按「无锁」处理），避免单个坏文件让 stop/start 全部失效。
 */
export function readPidStamp(file: string): PidStamp | null {
  if (!existsSync(file)) return null;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (looksHalfWritten(text)) {
    logger.warn(`进程锁内容为空（可能正在写入或已损坏）：${file}`);
    return null;
  }
  const parsed = parsePidFile(text);
  if (!parsed) {
    logger.warn(`进程锁内容非法：${file}`);
    return null;
  }
  // 旁路文件优先；兼容旧版本写在同一行的格式
  return { pid: parsed.pid, startTime: readStartTime(file) ?? parsed.startTime };
}

export function readProcessId(file: string): number | null {
  return readPidStamp(file)?.pid ?? null;
}

/** 判断 PID 文件记录的进程是否仍存活且身份一致（PID 被复用时视为已死） */
export function pidIsOurs(pid: number, startTime?: string): boolean {
  if (!processExists(pid)) return false;
  return matchesStartTime(pid, startTime) !== "mismatch";
}

/** 等待并发写入者完成 open→write 空窗的间隔 */
const HALF_WRITE_WAIT_MS = 50;

/**
 * 判断锁文件是否可安全回收。
 * 关键：内容为空/半写的文件**不能**直接当成「无锁」——另一启动者可能刚 open(O_EXCL)
 * 尚未写入字节，此时删掉它会破坏单实例保障（两个 supervisor 同跑）。
 * 因此对空内容做带间隔的重读；读失败（EACCES/EIO 等）保守视为「不可回收」：
 * 宁可启动失败让用户排查，也不能删掉可能存活进程的锁。
 */
function lockIsStale(file: string): boolean {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, HALF_WRITE_WAIT_MS);
    if (!existsSync(file)) return true;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      // 读失败 ≠ 空 ≠ 陈旧：保守拒绝回收
      logger.warn(`进程锁读取失败，保守视为不可回收：${file}：${String(error)}`);
      return false;
    }
    const parsed = parsePidFile(text);
    if (parsed) return !pidIsOurs(parsed.pid, readStartTime(file) ?? parsed.startTime);
    if (!looksHalfWritten(text)) return true;
  }
  logger.warn(`进程锁持续为空，按陈旧锁回收：${file}`);
  return true;
}

/** 回收独占文件标记：内容 PID 已死或文件损坏则视为陈旧，可安全删除 */
function reclaimIsStale(reclaim: string): boolean {
  return lockIsStale(reclaim);
}

export function acquireProcessLock(file: string): () => void {
  // 主文件保持纯数字（systemd PIDFile 契约），启动时间写入旁路文件
  const write = () => {
    writeFileSync(file, String(process.pid), { encoding: "utf8", flag: "wx", mode: 0o600 });
    const startTime = captureStartTime(process.pid);
    const sidecar = startTimeFile(file);
    try {
      if (startTime) writeFileSync(sidecar, startTime, { encoding: "utf8", mode: 0o600 });
      else unlinkSync(sidecar);
    } catch { /* 旁路写入失败只影响身份校验，不阻断取锁 */ }
  };
  try { write(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!lockIsStale(file)) {
      const stamp = readPidStamp(file);
      throw new Error(`已有进程运行（pid ${stamp?.pid ?? "未知"}）`);
    }
    // 回收旧锁也必须独占，并在取得回收权后重读，避免删除其他启动者的新锁。
    const reclaim = `${file}.reclaim`;
    const claim = () => writeFileSync(reclaim, String(process.pid), { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      claim();
    } catch (reclaimError) {
      if ((reclaimError as NodeJS.ErrnoException).code !== "EEXIST") throw reclaimError;
      // 上次进程在「已建 reclaim、未删除」之间被强杀会留下永久残留，此后永远无法启动。
      if (!reclaimIsStale(reclaim)) throw new Error(`另一启动者正在回收旧锁（${reclaim}）`);
      try {
        unlinkSync(reclaim);
        claim();
      } catch (takeoverError) {
        throw new Error(`另一启动者正在回收旧锁（${reclaim}）：${String(takeoverError)}`);
      }
    }
    try {
      const current = readPidStamp(file);
      if (current && pidIsOurs(current.pid, current.startTime)) throw new Error(`已有进程运行（pid ${current.pid}）`);
      try { unlinkSync(file); } catch { /* 已被他人回收 */ }
      try { unlinkSync(startTimeFile(file)); } catch { /* 不存在即可 */ }
      write();
    } finally {
      try { unlinkSync(reclaim); } catch { /* 已被他人回收 */ }
    }
  }
  return () => {
    if (readProcessId(file) === process.pid) {
      try { unlinkSync(file); } catch { /* 已删除 */ }
      try { unlinkSync(startTimeFile(file)); } catch { /* 不存在即可 */ }
    }
  };
}
