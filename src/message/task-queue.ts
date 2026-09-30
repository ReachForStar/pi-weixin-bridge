import { randomUUID } from "node:crypto";

export interface TaskInfo {
  id: string;
  state: "queued" | "running" | "stopping";
  description: string;
  createdAt: number;
  startedAt?: number;
}

interface Task extends TaskInfo {
  controller: AbortController;
  signal: AbortSignal;
}

export class TaskQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly tasks = new Map<string, Set<Task>>();

  run<T>(key: string, parent: AbortSignal, operation: (signal: AbortSignal) => Promise<T>, description = "消息任务"): Promise<T> {
    const controller = new AbortController();
    const signal = AbortSignal.any([parent, controller.signal]);
    const tasks = this.tasks.get(key) ?? new Set<Task>();
    const task: Task = {
      id: randomUUID(), state: "queued", description, createdAt: Date.now(), controller, signal,
    };
    tasks.add(task);
    this.tasks.set(key, tasks);
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(() => {
      if (!signal.aborted) {
        task.state = "running";
        task.startedAt = Date.now();
      }
      return operation(signal);
    });
    // 失败由调用方报告，队列仍须释放，以便后续消息继续处理。
    const completion = result.finally(() => {
      tasks.delete(task);
      if (!tasks.size) this.tasks.delete(key);
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    const tail = completion.then(() => {}, () => {});
    this.tails.set(key, tail);
    return completion;
  }

  list(key: string): TaskInfo[] {
    return [...(this.tasks.get(key) ?? [])].map(({ controller, signal, ...info }) => ({
      ...info, state: signal.aborted ? "stopping" : info.state,
    }));
  }

  stop(key: string, id?: string): boolean {
    const tasks = this.tasks.get(key);
    if (!tasks?.size) return false;
    const normalized = id?.trim().toLowerCase();
    if (id !== undefined && (!normalized || !/^[a-f0-9-]{8,36}$/.test(normalized))) {
      throw new Error("任务编号至少需要 8 位，请用 /tasks 查看");
    }
    const matches = [...tasks].filter((task) => !normalized || task.id.startsWith(normalized));
    if (normalized && matches.length > 1) throw new Error("任务编号不唯一，请输入更完整的编号");
    if (!matches.length) return false;
    for (const task of matches) {
      task.state = "stopping";
      task.controller.abort();
    }
    return true;
  }
}
