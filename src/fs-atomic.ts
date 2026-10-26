// 原子写共享工具：所有需要「要么完整写入、要么保持原样」的状态文件都应走这里。
// 此前 config.ts / account.ts / features/state.ts / ilink/context-store.ts 各自实现了一份，
// 且已出现分叉（失败时一个改名 .failed、一个 unlink；rename 失败均残留临时文件），
// 本模块统一为：独占创建临时文件(0o600) → 循环写满 → fsync → rename → fsync 父目录。
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

/** 循环写入直到写完：writeSync 是底层 write(2)，可能短写（磁盘将满/被信号打断） */
function writeFully(fd: number, payload: Buffer): void {
  let offset = 0;
  while (offset < payload.length) {
    offset += writeSync(fd, payload, offset, payload.length - offset);
  }
}

/** rename 后 fsync 父目录，保证目录项落盘（断电后不会回到旧内容或文件缺失） */
function fsyncDirectory(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
  } catch {
    // Windows 等平台不支持对目录 fsync：容错跳过，不影响写入本身
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* 关闭失败无需处理 */ }
    }
  }
}

/**
 * 原子写入文本文件。
 * @param file 目标路径（父目录不存在时自动创建，权限 0o700）
 * @param data 文本内容
 * @param mode 目标文件权限，默认 0o600（状态目录多含凭据）
 */
export function writeFileAtomic(file: string, data: string, mode = 0o600): void {
  const parent = dirname(file);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", mode);
  try {
    writeFully(fd, Buffer.from(data, "utf8"));
    fsyncSync(fd);
  } catch (error) {
    try { closeSync(fd); } catch { /* 忽略 */ }
    try { unlinkSync(temporary); } catch { /* 清理失败不掩盖原始错误 */ }
    throw error;
  }
  closeSync(fd);
  try {
    renameSync(temporary, file);
  } catch (error) {
    // Windows 上目标被占用时 rename 会失败：及时清理临时文件，避免状态目录持续堆积
    try { unlinkSync(temporary); } catch { /* 清理失败不掩盖原始错误 */ }
    throw error;
  }
  fsyncDirectory(parent);
}

/** 目录是否存在（供调用方在需要时判断，避免各自重复 import existsSync） */
export function dirExists(dir: string): boolean {
  return existsSync(dir);
}
