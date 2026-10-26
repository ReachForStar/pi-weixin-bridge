import { randomUUID } from "node:crypto";
import { ScopedState } from "./state.js";

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
  list(key: string): TaskRecord[] {
    const entries = this.state.get(key);
    if (!this.initialized.has(key)) {
      // 进程重启后残留的 running 记录已不可能继续，标记为中断；每个 key 只做一次
      let changed = false;
      for (const entry of entries) {
        if (entry.state === "running") { entry.state = "interrupted"; changed = true; }
      }
      if (changed) this.state.set(key, entries);
      this.initialized.add(key);
    }
    return entries.map((entry) => ({ ...entry, files: [...entry.files] }));
  }
  begin(key: string, text: string, project: string, messageId?: number): TaskRecord | undefined {
    const entries = this.state.get(key);
    if (messageId !== undefined && entries.some((entry) => entry.messageId === messageId)) return undefined;
    if (!this.initialized.has(key)) {
      // 首次接触该 key：残留的 running 记录不可能还在执行，标记为中断
      for (const entry of entries) if (entry.state === "running") entry.state = "interrupted";
      this.initialized.add(key);
    }
    const entry: TaskRecord = { id: randomUUID(), text, project, messageId, files: [], createdAt: Date.now(), state: "running" };
    const next = [...entries, entry];
    // 超出上限时丢弃最旧记录，控制单文件体积与每次全量重写的成本
    this.state.set(key, next.length > MAX_RECORDS ? next.slice(-MAX_RECORDS) : next);
    return { ...entry, files: [] };
  }
  update(key: string, id: string, patch: Partial<Pick<TaskRecord, "files" | "state" | "result" | "error">>): void {
    const entries = this.state.get(key);
    const entry = entries.find((item) => item.id === id);
    if (!entry) throw new Error("任务记录不存在");
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
