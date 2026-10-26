import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { CronExpressionParser } from "cron-parser";
import { STATE_DIR } from "../config.js";
import { readJson, saveJson } from "./state.js";

export interface ScheduledJob {
  id: string;
  account: string;
  key: string;
  user: string;
  prompt: string;
  cron?: string;
  at?: string;
  timeZone: string;
  nextAt: number;
  enabled: boolean;
  status?: "running" | "completed" | "failed" | "interrupted";
  lastRun?: number;
  lastError?: string;
  project: string;
}
export class Scheduler {
  private jobs: ScheduledJob[];
  private readonly active = new Set<string>();
  constructor(private readonly file = join(STATE_DIR, "schedules.json")) {
    this.jobs = readJson(file, []);
    let changed = false;
    for (const job of this.jobs) if (job.status === "running") {
      job.status = "interrupted"; job.enabled = false; changed = true;
    }
    if (changed) this.save();
  }
  private save(): void { saveJson(this.file, this.jobs); }
  list(key: string): ScheduledJob[] { return this.jobs.filter((job) => job.key === key).map((job) => ({ ...job })); }
  add(input: Omit<ScheduledJob, "id" | "nextAt" | "enabled" | "status">): ScheduledJob {
    new Intl.DateTimeFormat("en", { timeZone: input.timeZone });
    if (!input.prompt?.trim() || input.prompt.length > 8000) throw new Error("定时任务指令需要 1–8000 个字符");
    if (Boolean(input.cron) === Boolean(input.at)) throw new Error("cron 与 at 必须且只能设置一个");
    let nextAt: number;
    if (input.cron) nextAt = CronExpressionParser.parse(input.cron, { tz: input.timeZone }).next().getTime();
    else {
      if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.at!)) throw new Error("at 使用带时区的 ISO 日期，例如 2026-10-01T09:00:00+08:00");
      nextAt = Date.parse(input.at!);
      if (!Number.isFinite(nextAt) || nextAt <= Date.now()) throw new Error("执行时间必须晚于当前时间");
    }
    const job = { ...input, id: randomUUID(), nextAt, enabled: true };
    this.jobs.push(job); this.save(); return { ...job };
  }
  edit(key: string, id: string, action: "pause" | "resume" | "delete"): void {
    if (!/^[a-f0-9-]{8,36}$/i.test(id)) throw new Error("定时任务编号至少需要 8 位");
    const matches = this.jobs.filter((job) => job.key === key && job.id.startsWith(id.toLowerCase()));
    if (matches.length !== 1) throw new Error("定时任务不存在或编号不唯一");
    const job = matches[0];
    if (this.active.has(job.id)) throw new Error("任务正在执行，请先 /stop；执行结束后再修改");
    if (action === "delete") this.jobs = this.jobs.filter((item) => item !== job);
    else {
      if (action === "resume") {
        if (job.cron) job.nextAt = CronExpressionParser.parse(job.cron, { tz: job.timeZone }).next().getTime();
        else if (job.nextAt < Date.now()) throw new Error("单次任务时间已过，请新建任务");
      }
      job.enabled = action === "resume";
    }
    this.save();
  }
  async tick(account: string, execute: (job: ScheduledJob) => Promise<void>, signal?: AbortSignal): Promise<void> {
    for (const job of this.jobs) {
      if (signal?.aborted) break;
      if (!job.enabled || job.account !== account || job.nextAt > Date.now() || this.active.has(job.id) || this.active.size >= 2) continue;
      this.active.add(job.id);
      job.status = "running"; job.lastRun = Date.now(); this.save();
      try { await execute({ ...job }); job.status = "completed"; job.lastError = undefined; }
      catch (error) { job.status = signal?.aborted ? "interrupted" : "failed"; job.lastError = error instanceof Error ? error.message.slice(0, 240) : "执行或投递失败"; job.enabled = false; }
      finally {
        if (job.enabled && job.cron) job.nextAt = CronExpressionParser.parse(job.cron, { tz: job.timeZone }).next().getTime();
        else job.enabled = false;
        this.active.delete(job.id); this.save();
      }
    }
  }
}
