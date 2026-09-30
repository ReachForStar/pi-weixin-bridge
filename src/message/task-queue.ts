export class TaskQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, Set<AbortController>>();

  run<T>(key: string, parent: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const signal = AbortSignal.any([parent, controller.signal]);
    const tasks = this.controllers.get(key) ?? new Set<AbortController>();
    tasks.add(controller);
    this.controllers.set(key, tasks);
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(() => operation(signal));
    // 失败由调用方报告，队列仍须释放，以便后续消息继续处理。
    const tail = result.then(() => {}, () => {}).finally(() => {
      tasks.delete(controller);
      if (!tasks.size) this.controllers.delete(key);
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    this.tails.set(key, tail);
    return result;
  }

  stop(key: string): boolean {
    const tasks = this.controllers.get(key);
    if (!tasks?.size) return false;
    for (const controller of tasks) controller.abort();
    return true;
  }
}
