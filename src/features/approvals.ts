import { randomUUID } from "node:crypto";

interface Approval {
  id: string;
  key: string;
  description: string;
  expires: number;
  settle: (allow: boolean) => void;
}

export class Approvals {
  private readonly pending = new Map<string, Approval>();
  constructor(private readonly timeoutMs = 120_000) {}
  async request(key: string, description: string, send: (text: string) => Promise<void>, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    let id = randomUUID().slice(0, 8);
    while (this.pending.has(id)) id = randomUUID().slice(0, 8);
    let settle!: (allow: boolean) => void;
    const answer = new Promise<boolean>((resolve) => { settle = resolve; });
    const approval = { id, key, description, expires: Date.now() + this.timeoutMs, settle };
    this.pending.set(id, approval);
    const abort = () => settle(false);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    try {
      await send(`🔐 等待操作确认 ${id}\n\n${description}\n\n/approve ${id} 允许本次操作\n/reject ${id} 拒绝\n有效期 ${Math.ceil(this.timeoutMs / 1000)} 秒；超时不执行。`);
      signal?.throwIfAborted();
      if (!await answer) throw new Error("操作未获确认，已拒绝或超时");
      signal?.throwIfAborted();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      this.pending.delete(id);
    }
  }
  resolve(key: string, id: string, allow: boolean): boolean {
    const item = this.pending.get(id.toLowerCase());
    if (!item || item.key !== key || item.expires <= Date.now()) return false;
    this.pending.delete(item.id);
    item.settle(allow);
    return true;
  }
  cancel(key: string): void {
    for (const item of this.pending.values()) if (item.key === key) { this.pending.delete(item.id); item.settle(false); }
  }
}
