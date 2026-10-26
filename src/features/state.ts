import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { STATE_DIR } from "../config.js";
import { logger } from "../logger/index.js";

export function scopeId(key: string): string {
  if (!key) throw new Error("会话标识不能为空");
  return createHash("sha256").update(key).digest("hex");
}

/**
 * 读取状态文件；损坏时隔离原文件并回退空值。
 * 状态类数据（任务记录、资料、定时任务）损坏只应让对应功能降级，
 * 不应让整个服务或该用户的全部消息不可用；原文件改名保留以便人工恢复。
 */
export function readJson<T>(file: string, empty: T): T {
  if (!existsSync(file)) return empty;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (error) {
    const backup = `${file}.corrupt-${Date.now()}`;
    try {
      renameSync(file, backup);
      logger.error(`状态文件损坏已隔离：${file}（原因：${String(error)}），备份为 ${backup}，本次按空数据处理`);
    } catch (renameError) {
      logger.error(`状态文件损坏且无法隔离：${file}（读取原因：${String(error)}；改名原因：${String(renameError)}），本次按空数据处理`);
    }
    return empty;
  }
}

/** 原子写：临时文件独占创建（0o600）→ fsync → rename，避免断电留下半截文件 */
export function saveJson(file: string, value: unknown): void {
  const parent = dirname(file);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(value, null, 2), null, "utf8");
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    try { renameSync(temporary, `${temporary}.failed`); } catch { /* 清理失败不掩盖原始错误 */ }
    throw error;
  }
  closeSync(fd);
  renameSync(temporary, file);
}

export class ScopedState<T> {
  constructor(private readonly category: string, private readonly empty: () => T, private readonly root = STATE_DIR) {}
  private file(key: string): string { return join(this.root, this.category, `${scopeId(key)}.json`); }
  get(key: string): T { return readJson(this.file(key), this.empty()); }
  set(key: string, value: T): void { saveJson(this.file(key), value); }
}
