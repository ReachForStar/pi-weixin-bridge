import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { FileLibrary } from "../src/features/library.js";
import { TaskJournal } from "../src/features/journal.js";
import { Scheduler } from "../src/features/scheduler.js";
import { Approvals } from "../src/features/approvals.js";
import { checkedPath } from "../src/features/policy.js";
import { ConversationStore } from "../src/pi/conversation-store.js";
import { acquireProcessLock } from "../src/daemon/process-lock.js";
import { runSupervisor } from "../src/daemon/supervisor.js";
import { existsSync } from "node:fs";
import { uploadFile } from "../src/ilink/media.js";
import { IlinkClient } from "../src/ilink/client.js";

async function directory(): Promise<string> {
  await mkdir("tmp", { recursive: true });
  return mkdtemp(resolve("tmp", "feature-check-"));
}

describe("真实文件与持久状态", () => {
  it("资料内容去重、中文检索、重启恢复和会话隔离", async () => {
    const root = await directory();
    const library = new FileLibrary(root);
    const entry = await library.add("owner", { name: "README.md", path: resolve("README.md") }, root);
    const duplicate = await library.add("owner", { name: "README.md", path: resolve("README.md") }, root);
    expect(duplicate.id).toBe(entry.id);
    expect(await readFile(entry.path, "utf8")).toBe(await readFile("README.md", "utf8"));
    expect((await library.search("owner", "微信"))[0].id).toBe(entry.id);
    expect(await library.search("other", "微信")).toEqual([]);
    expect(new FileLibrary(root).get("owner", entry.id.slice(0, 8)).hash).toBe(entry.hash);
    await expect(checkedPath(resolve("LICENSE"), root)).rejects.toThrow("超出");
    expect(await checkedPath(entry.path, root)).toBe(entry.path);
  });

  it("任务编号去重、结果保存、重启标记中断并拒绝跨会话查询", async () => {
    const root = await directory();
    const journal = new TaskJournal(root);
    const completed = journal.begin("owner", "读取许可证", "default", 1)!;
    journal.update("owner", completed.id, { state: "completed", result: await readFile("LICENSE", "utf8") });
    expect(journal.begin("owner", "读取许可证", "default", 1)).toBeUndefined();
    const unfinished = journal.begin("owner", "尚未完成的任务", "default", 2)!;
    const restarted = new TaskJournal(root);
    expect(restarted.get("owner", unfinished.id).state).toBe("interrupted");
    expect(restarted.get("owner", completed.id).result).toContain("MIT License");
    expect(() => restarted.get("other", completed.id)).toThrow("不存在");
  });

  it("使用 pi SDK 命名、列出并恢复真实会话文件", async () => {
    const root = await directory();
    const store = new ConversationStore(join(root, "sessions"), root);
    const first = store.open("owner");
    store.rename("owner", "许可证审阅");
    const second = store.reset("owner");
    expect(second.getSessionId()).not.toBe(first.getSessionId());
    const listed = await store.list("owner");
    expect(listed.find((entry) => entry.id === first.getSessionId())?.name).toBe("许可证审阅");
    await store.resume("owner", first.getSessionId());
    expect(new ConversationStore(join(root, "sessions"), root).open("owner").getSessionId()).toBe(first.getSessionId());
    await expect(store.resume("other", first.getSessionId())).rejects.toThrow("不存在");
  });

  it("独占进程锁拒绝重复实例，释放后可再次取得", async () => {
    const file = join(await directory(), "instance.pid");
    const release = acquireProcessLock(file);
    expect(() => acquireProcessLock(file)).toThrow("已有进程");
    release();
    const releaseAgain = acquireProcessLock(file);
    expect(await readFile(file, "utf8")).toBe(String(process.pid));
    releaseAgain();
  });

  it("已取消的文件回传直接终止，不发送上传请求", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadFile(new IlinkClient("http://127.0.0.1:1"), resolve("LICENSE"), "owner", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("真实长运行子进程在 supervisor 停止时退出并释放锁", async () => {
    const root = await directory();
    const child = join(root, "running-child.mjs");
    await writeFile(child, 'setInterval(() => process.stdout.write("运行中\\n"), 30);', "utf8");
    const deadline = Date.now() + 600;
    let exitCode: number | null | undefined;
    await runSupervisor({ daemonDir: root, childArgs: [child], shouldStop: () => Date.now() >= deadline,
      onChildExit: (code) => { exitCode = code; } });
    expect(exitCode).not.toBeUndefined();
    expect(existsSync(join(root, "supervisor.pid"))).toBe(false);
    expect(existsSync(join(root, "bridge.pid"))).toBe(false);
    expect(await readFile(join(root, "bridge.log"), "utf8")).toContain("运行中");
  });
});

describe("操作确认", () => {
  it("确认绑定当前会话、编号只消费一次", async () => {
    const approvals = new Approvals(1000);
    let id = "";
    const request = approvals.request("owner", "读取并发送许可证", async (message) => {
      id = message.match(/确认 ([a-f0-9]{8})/)![1];
    });
    expect(approvals.resolve("other", id, true)).toBe(false);
    expect(approvals.resolve("owner", id, true)).toBe(true);
    expect(approvals.resolve("owner", id, true)).toBe(false);
    await request;
  });

  it("真实计时超时和退出信号均拒绝操作", async () => {
    await expect(new Approvals(30).request("owner", "超时确认", async () => {})).rejects.toThrow("超时");
    const controller = new AbortController();
    const request = new Approvals().request("owner", "退出确认", async () => {}, controller.signal);
    const result = expect(request).rejects.toThrow();
    controller.abort();
    await result;
  });
});

describe("真实时钟与 cron-parser 调度", () => {
  it("到期任务只执行一次，记录成功状态并持久化", async () => {
    const root = await directory();
    const scheduler = new Scheduler(join(root, "schedules.json"));
    const job = scheduler.add({ key: "owner", user: "owner", account: "account", project: "default", prompt: "复制许可证",
      timeZone: "Asia/Shanghai", at: new Date(Date.now() + 80).toISOString() });
    await delay(100);
    let executions = 0;
    await scheduler.tick("account", async () => { executions++; await writeFile(join(root, "LICENSE"), await readFile("LICENSE")); });
    await scheduler.tick("account", async () => { executions++; });
    expect(executions).toBe(1);
    expect(new Scheduler(join(root, "schedules.json")).list("owner")[0].status).toBe("completed");
    expect(scheduler.list("owner")[0].enabled).toBe(false);
    expect(() => scheduler.edit("owner", job.id, "resume")).toThrow("时间已过");
    expect(scheduler.list("owner")[0].enabled).toBe(false);
  });

  it("校验时区与周期，暂停恢复及删除不影响其他对话", async () => {
    const scheduler = new Scheduler(join(await directory(), "schedules.json"));
    const input = { key: "owner", user: "owner", account: "account", project: "default", prompt: "检查工作目录", timeZone: "Asia/Shanghai", cron: "0 9 * * *" };
    const job = scheduler.add(input);
    expect(new Date(job.nextAt).toISOString()).toMatch(/T01:00:00/);
    expect(() => scheduler.add({ ...input, timeZone: "invalid-zone" })).toThrow();
    expect(() => scheduler.edit("other", job.id, "pause")).toThrow("不存在");
    scheduler.edit("owner", job.id, "pause");
    expect(scheduler.list("owner")[0].enabled).toBe(false);
    scheduler.edit("owner", job.id, "resume");
    expect(scheduler.list("owner")[0].enabled).toBe(true);
    scheduler.edit("owner", job.id, "delete");
    expect(scheduler.list("owner")).toEqual([]);
  });

  it("执行失败暂停并保存原因", async () => {
    const scheduler = new Scheduler(join(await directory(), "schedules.json"));
    scheduler.add({ key: "owner", user: "owner", account: "account", project: "default", prompt: "读取不存在的文件", timeZone: "UTC", at: new Date(Date.now() + 50).toISOString() });
    await delay(80);
    await scheduler.tick("account", async () => { await readFile(join(await directory(), "missing.txt")); });
    expect(scheduler.list("owner")[0].status).toBe("failed");
    expect(scheduler.list("owner")[0].enabled).toBe(false);
    expect(scheduler.list("owner")[0].lastError).toContain("ENOENT");
  });
});
