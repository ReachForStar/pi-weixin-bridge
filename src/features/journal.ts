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

export class TaskJournal {
  private readonly state: ScopedState<TaskRecord[]>;
  private readonly initialized = new Set<string>();
  constructor(root?: string) { this.state = new ScopedState("tasks", () => [], root); }
  list(key: string): TaskRecord[] {
    const entries = this.state.get(key);
    if (!this.initialized.has(key)) {
      for (const entry of entries) if (entry.state === "running") entry.state = "interrupted";
      this.state.set(key, entries);
      this.initialized.add(key);
    }
    return entries;
  }
  begin(key: string, text: string, project: string, messageId?: number): TaskRecord | undefined {
    const entries = this.list(key);
    if (messageId !== undefined && entries.some((entry) => entry.messageId === messageId)) return undefined;
    const entry: TaskRecord = { id: randomUUID(), text, project, messageId, files: [], createdAt: Date.now(), state: "running" };
    this.state.set(key, [...entries, entry]);
    return entry;
  }
  update(key: string, id: string, patch: Partial<Pick<TaskRecord, "files" | "state" | "result" | "error">>): void {
    const entries = this.list(key);
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
