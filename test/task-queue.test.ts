import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { TaskQueue } from "../src/message/task-queue.js";
import { prepareInboundDocuments } from "../src/message/documents.js";

describe("完整任务队列", () => {
  it("同一对话文档按接收顺序转换，其他对话可同时读取", async () => {
    await mkdir("tmp", { recursive: true });
    const root = await mkdtemp(join("tmp", "queue-documents-"));
    const pdf = join(root, "license.pdf");
    const docx = join(root, "license.docx");
    await copyFile("test/fixtures/project-license.pdf", pdf);
    await copyFile("test/fixtures/project-license.docx", docx);
    const queue = new TaskQueue();
    const parent = new AbortController().signal;
    const completed: string[] = [];
    const first = queue.run("conversation", parent, async (signal) => {
      await delay(30, undefined, { signal });
      await prepareInboundDocuments([{ name: "license.pdf", path: pdf }], { signal });
      completed.push(pdf);
    });
    const second = queue.run("conversation", parent, async (signal) => {
      expect(await readFile(`${pdf}.md`, "utf8")).toContain("MIT License");
      await prepareInboundDocuments([{ name: "license.docx", path: docx }], { signal });
      completed.push(docx);
    });
    await queue.run("other", parent, async () => {
      expect(await readFile("LICENSE", "utf8")).toContain("MIT License");
      expect(completed).toEqual([]);
    });
    await Promise.all([first, second]);
    expect(completed).toEqual([pdf, docx]);
  });

  it("停止当前与等待任务，后续新消息可执行", async () => {
    const queue = new TaskQueue();
    const parent = new AbortController().signal;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const first = queue.run("conversation", parent, async (signal) => {
      started();
      await delay(60_000, undefined, { signal });
    });
    const second = queue.run("conversation", parent, async (signal) => {
      signal.throwIfAborted();
      return readFile("LICENSE", "utf8");
    });
    const firstCheck = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const secondCheck = expect(second).rejects.toMatchObject({ name: "AbortError" });
    await ready;
    expect(queue.stop("conversation")).toBe(true);
    const next = queue.run("conversation", parent, async (signal) => {
      signal.throwIfAborted();
      return readFile("LICENSE", "utf8");
    });
    await Promise.all([firstCheck, secondCheck]);
    expect(await next).toContain("MIT License");
    expect(queue.stop("missing")).toBe(false);
  });

  it("真实文件读取失败不阻塞下一条任务，服务退出信号传入任务", async () => {
    const queue = new TaskQueue();
    const controller = new AbortController();
    await expect(queue.run("conversation", controller.signal,
      () => readFile("test/fixtures/missing-document.pdf"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await queue.run("conversation", controller.signal, () => readFile("LICENSE", "utf8")))
      .toContain("MIT License");
    controller.abort();
    await expect(queue.run("conversation", controller.signal, async (signal) => {
      signal.throwIfAborted();
      return readFile("LICENSE", "utf8");
    })).rejects.toMatchObject({ name: "AbortError" });
  });
});
