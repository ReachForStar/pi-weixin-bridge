import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { CronExpressionParser } from "cron-parser";
import { STATE_DIR } from "../config.js";
import { readJson, saveJson, isArrayOf, isPlainObject } from "./state.js";
import { logger } from "../logger/index.js";

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

/** 用户 /stop 或服务退出导致的中止：不是任务失败，不应停用周期任务 */
export class JobCancelledError extends Error {
  constructor() {
    super("定时任务已停止");
    this.name = "JobCancelledError";
  }
}
export class Scheduler {
  private jobs: ScheduledJob[];
  private readonly active = new Set<string>();
  constructor(private readonly file = join(STATE_DIR, "schedules.json")) {
    // 构造期在 Features/bridge 启动路径上：读取失败只降级为「无任务」，
    // 不能让整个服务起不来。save() 不会自动触发，原文件在下次成功读取前不会被覆盖。
    try {
      this.jobs = readJson(file, [], isArrayOf<ScheduledJob>((item) => isPlainObject(item)
        && typeof item.id === "string" && typeof item.key === "string" && typeof item.account === "string"
        && typeof item.prompt === "string" && typeof item.project === "string" && typeof item.timeZone === "string"
        && typeof item.nextAt === "number" && typeof item.enabled === "boolean"));
    } catch (error) {
      logger.warn(`schedules.json 读取失败，本次按无定时任务运行（原文件未改动）：${String(error)}`);
      this.jobs = [];
    }
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
    // 串行执行：一个 tick 内逐个 await，跨 tick 由 active 集合防重入；不引入并发上限（串行下无意义）
    for (const job of this.jobs) {
      if (signal?.aborted) break;
      if (!job.enabled || job.account !== account || job.nextAt > Date.now() || this.active.has(job.id)) continue;
      this.active.add(job.id);
      job.status = "running"; job.lastRun = Date.now(); this.save();
      try { await execute({ ...job }); job.status = "completed"; job.lastError = undefined; }
      catch (error) {
        if (error instanceof JobCancelledError) {
          job.status = "interrupted"; job.lastError = undefined;
        } else {
          job.status = signal?.aborted ? "interrupted" : "failed";
          job.lastError = error instanceof Error ? error.message.slice(0, 240) : "执行或投递失败";
          // 中断（服务退出）不是任务本身失败；只有真实失败才停用，避免一次停机废掉周期任务
          if (!signal?.aborted) job.enabled = false;
          logger.error(`定时任务 ${job.id} 执行失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        }
      }
      finally {
        // 先释放 active：cron 解析或保存失败时不能让任务在当前进程里永久阻塞
        this.active.delete(job.id);
        if (job.status === "interrupted") {
          // 周期任务推进到下一次；单次任务停用，避免仍在过去的时间被下一秒重复触发
          if (job.enabled && job.cron) {
            try { job.nextAt = CronExpressionParser.parse(job.cron, { tz: job.timeZone }).next().getTime(); }
            catch (error) { logger.error(`定时任务 ${job.id} 的 cron 无法计算下次执行时间，已停用：${String(error)}`); job.enabled = false; }
          } else {
            job.enabled = false;
          }
        } else if (job.enabled && job.cron) {
          try { job.nextAt = CronExpressionParser.parse(job.cron, { tz: job.timeZone }).next().getTime(); }
          catch (error) { logger.error(`定时任务 ${job.id} 的 cron 无法计算下次执行时间，已停用：${String(error)}`); job.enabled = false; }
        } else {
          job.enabled = false;
        }
        try { this.save(); } catch (error) { logger.error(`定时任务状态写入失败：${String(error)}`); }
      }
    }
  }
}
