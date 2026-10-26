import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { TaskQueue } from "../src/message/task-queue.js";
import { SlashCommandHandler } from "../src/command.js";
import { PiSessionManager } from "../src/pi/sessions.js";

describe("微信任务管理", () => {
  it("命令列出真实文件任务并单独取消，剩余任务与其他对话继续", async () => {
    const queue = new TaskQueue();
    const parent = new AbortController().signal;
    const handler = new SlashCommandHandler(new PiSessionManager(), "local");
    const context = {
      key: "conversation",
      listTasks: () => queue.list("conversation"),
      cancelTask: (id: string) => queue.stop("conversation", id),
    };
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const first = queue.run("conversation", parent, async (signal) => {
      started();
      await delay(60_000, undefined, { signal });
      return readFile("LICENSE", "utf8");
    }, "读取许可证");
    const firstCheck = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = queue.run("conversation", parent, async (signal) => {
      signal.throwIfAborted();
      return readFile("README.md", "utf8");
    }, "读取说明文档");
    await ready;
    const tasks = queue.list(context.key);
    expect(tasks.map((task) => task.state)).toEqual(["running", "queued"]);
    expect(tasks[0].startedAt).toBeGreaterThanOrEqual(tasks[0].createdAt);
    expect(tasks[0].id).not.toBe(tasks[1].id);
    expect(queue.list("other")).toEqual([]);
    expect(queue.stop("other", tasks[0].id)).toBe(false);
    const reply = await handler.handle("/tasks", context);
    expect(reply).toContain(tasks[0].id.slice(0, 8));
    expect(reply).toContain("处理中");
    expect(reply).toContain("等待中");
    expect(reply).toContain("读取说明文档");
    expect(await handler.handle(`/cancel ${tasks[0].id.slice(0, 8)}`, context)).toContain("其余任务继续");
    await firstCheck;
    expect(await second).toContain("pi-weixin-bridge");
    expect(queue.list(context.key)).toEqual([]);
    expect(await handler.handle("/tasks", context)).toContain("没有正在处理");
  });

  it("取消等待中的消息不会取消正在处理的任务，命令校验编号", async () => {
    const queue = new TaskQueue();
    const parent = new AbortController().signal;
    const handler = new SlashCommandHandler(new PiSessionManager(), "local");
    const context = { key: "conversation", cancelTask: (id: string) => queue.stop("conversation", id) };
    const first = queue.run(context.key, parent, async (signal) => {
      await delay(30, undefined, { signal });
      return readFile("LICENSE", "utf8");
    });
    const second = queue.run(context.key, parent, async (signal) => {
      signal.throwIfAborted();
      return readFile("README.md", "utf8");
    });
    const secondCheck = expect(second).rejects.toMatchObject({ name: "AbortError" });
    const id = queue.list(context.key)[1].id;
    expect(await handler.handle("/cancel", context)).toContain("用法");
    expect(await handler.handle("/cancel abc", context)).toContain("至少需要 8 位");
    expect(await handler.handle(`/cancel ${id.toUpperCase()}`, context)).toContain("已请求取消");
    expect(queue.list(context.key)[1].state).toBe("stopping");
    expect(await first).toContain("MIT License");
    await secondCheck;
    expect(queue.list(context.key)).toEqual([]);
    expect(await handler.handle(`/cancel ${id}`, context)).toContain("未找到");
  });
});
