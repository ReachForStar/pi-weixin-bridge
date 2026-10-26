import { randomUUID } from "node:crypto";
import { ScopedState } from "./state.js";
import { logger } from "../logger/index.js";

export interface TaskRecord {
  id: string;
  messageId?: number;
  text: string;
  files: string[];
  project: string;
  createdAt: number;
  finishedAt?: number;
  state: "running" | "completed" | "failed" | "stopped" | "interrupted";
  result?: string;
  error?: string;
}

/** 单会话保留的任务记录上限；超出后丢弃最旧的，避免长期使用后无界增长与写入放大 */
const MAX_RECORDS = 500;

export class TaskJournal {
  private readonly state: ScopedState<TaskRecord[]>;
  private readonly initialized = new Set<string>();
  constructor(root?: string) { this.state = new ScopedState("tasks", () => [], root); }
  /** 读取记录（返回副本，避免调用方改动内存态却不落盘） */
  /** 首次接触该 key 时把残留的 running 标记为中断（进程重启后不可能还在执行） */
  private repairOnce(key: string, entries: TaskRecord[]): boolean {
    if (this.initialized.has(key)) return false;
    this.initialized.add(key);
    let changed = false;
    for (const entry of entries) {
      if (entry.state === "running") { entry.state = "interrupted"; changed = true; }
    }
    return changed;
  }
  list(key: string): TaskRecord[] {
    const entries = this.state.get(key);
    if (this.repairOnce(key, entries)) this.state.set(key, entries);
    return entries.map((entry) => ({ ...entry, files: [...entry.files] }));
  }
  begin(key: string, text: string, project: string, messageId?: number): TaskRecord | undefined {
    const entries = this.state.get(key);
    // 先修复再判重：残留的 running 标记须在中断判定之后参与去重比较
    if (this.repairOnce(key, entries)) this.state.set(key, entries);
    if (messageId !== undefined && entries.some((entry) => entry.messageId === messageId)) return undefined;
    const entry: TaskRecord = { id: randomUUID(), text, project, messageId, files: [], createdAt: Date.now(), state: "running" };
    const next = [...entries, entry];
    // 超上限时丢最旧的已结束记录；running 优先保留（被挤掉会让该任务收尾的 update() 抛错）。
    // 若保留 running 后仍超上限（异常积压），再从头部整体截断，总量恒定有界。
    const overflow = next.length - MAX_RECORDS;
    let kept: TaskRecord[];
    if (overflow <= 0) kept = next;
    else {
      const finishedDropped = next.filter((item, index) => item.state === "running" || index >= overflow);
      kept = finishedDropped.length > MAX_RECORDS + 64
        ? finishedDropped.slice(finishedDropped.length - MAX_RECORDS - 64)
        : finishedDropped;
    }
    this.state.set(key, kept);
    return { ...entry, files: [] };
  }
  update(key: string, id: string, patch: Partial<Pick<TaskRecord, "files" | "state" | "result" | "error">>): void {
    const entries = this.state.get(key);
    this.repairOnce(key, entries);
    const entry = entries.find((item) => item.id === id);
    if (!entry) {
      // 记录已被上限裁剪（极端积压时）：丢弃本次回写，不抛错覆盖任务的原始结果
      logger.warn(`任务记录 ${id} 已因上限裁剪移除，本次状态回写被跳过`);
      return;
    }
    Object.assign(entry, patch);
    if (patch.state && patch.state !== "running") entry.finishedAt = Date.now();
    this.state.set(key, entries);
  }
  get(key: string, id: string): TaskRecord {
    if (!/^[a-f0-9-]{8,36}$/i.test(id)) throw new Error("任务编号至少需要 8 位");
    const matches = this.list(key).filter((item) => item.id.startsWith(id.toLowerCase()));
    if (matches.length !== 1) throw new Error("任务编号不存在或不唯一");
    return matches[0];
  }
}
