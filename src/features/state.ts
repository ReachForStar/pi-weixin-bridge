import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR } from "../config.js";
import { logger } from "../logger/index.js";
import { writeFileAtomic } from "../fs-atomic.js";

export function scopeId(key: string): string {
  if (!key) throw new Error("会话标识不能为空");
  return createHash("sha256").update(key).digest("hex");
}

/** 只有「文件不存在」才应视为空；EACCES/EMFILE 等瞬时 IO 错误不能当成损坏去隔离 */
function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/** 把损坏文件改名隔离，保留现场便于人工恢复 */
function isolate(file: string, reason: unknown): void {
  const backup = `${file}.corrupt-${Date.now()}`;
  try {
    renameSync(file, backup);
    logger.error(`状态文件损坏已隔离：${file}（原因：${String(reason)}），备份为 ${backup}，本次按空数据处理`);
  } catch (renameError) {
    logger.error(`状态文件损坏且无法隔离：${file}（读取原因：${String(reason)}；改名原因：${String(renameError)}），本次按空数据处理`);
  }
}

/**
 * 读取状态文件；损坏时隔离原文件并回退空值。
 * 状态类数据（任务记录、资料、定时任务）损坏只应让对应功能降级，
 * 不应让整个服务或该用户的全部消息不可用；原文件改名保留以便人工恢复。
 *
 * isValid 提供结构校验：语法合法但形状不符（如 `null`、`{}` 写成数组）同样必须降级，
 * 否则下游 `entries.map(...)` / `for (const job of this.jobs)` 仍会抛 TypeError。
 */
export function readJson<T>(file: string, empty: T, isValid?: (value: unknown) => value is T): T {
  let text: string;
  try {
    if (!existsSync(file)) return empty;
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return empty;
    // 瞬时 IO 错误（权限/句柄耗尽）不能当空数据处理：调用方往往是「读-改-写」，
    // 若这里返回 empty，随后的 set() 会用残缺快照覆盖原文件，造成真实数据丢失。
    // 宁可让本次操作失败，交由上层各自的 catch 降级（消息报错重试 / 功能暂不可用）。
    throw new Error(`状态文件读取失败（本次操作中止，原文件未改动）：${file}：${String(error)}`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    isolate(file, error);
    return empty;
  }
  if (isValid && !isValid(parsed)) {
    isolate(file, new Error("结构不符合预期"));
    return empty;
  }
  return parsed as T;
}

/** 原子写：统一走 fs-atomic（循环写满 + fsync 文件与父目录），避免断电留下半截文件 */
export function saveJson(file: string, value: unknown): void {
  writeFileAtomic(file, JSON.stringify(value, null, 2));
}

export class ScopedState<T> {
  constructor(
    private readonly category: string,
    private readonly empty: () => T,
    private readonly root = STATE_DIR,
    /** 结构校验：语法合法但形状不符时同样降级，避免下游抛出 TypeError */
    private readonly isValid?: (value: unknown) => value is T,
  ) {}
  private file(key: string): string { return join(this.root, this.category, `${scopeId(key)}.json`); }
  get(key: string): T { return readJson(this.file(key), this.empty(), this.isValid); }
  set(key: string, value: T): void { saveJson(this.file(key), value); }
}

/** 供各状态模块复用的形状校验器 */
export function isArrayOf<T>(itemCheck: (value: unknown) => boolean): (value: unknown) => value is T[] {
  return (value: unknown): value is T[] => Array.isArray(value) && value.every(itemCheck);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
