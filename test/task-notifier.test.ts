import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { TaskNotifier } from "../src/message/task-notifier.js";

function outputFile(): string {
  mkdirSync("tmp", { recursive: true });
  return join(mkdtempSync(join("tmp", "notification-test-")), "messages.txt");
}

describe("任务通知生命周期", () => {
  // 2026-10-23 起：typing 状态承担"处理中"反馈，不再发送文本确认与周期性进度。
  it("进度阶段不产生文本通知，完成后只发一次完成文本", async () => {
    const file = outputFile();
    const notifier = new TaskNotifier((text) => appendFile(file, `${text}\n`, "utf8"), 20);
    notifier.start();
    notifier.update({ stage: "tool", toolName: "bash" });
    try {
      await delay(55);
      await notifier.stopProgress();
      expect(() => readFileSync(file, "utf8")).toThrow(); // 无确认、无周期进度
      notifier.update({ stage: "tool-completed", failed: false });
      await notifier.finish("本次任务已处理完成");
      const completed = readFileSync(file, "utf8");
      expect(completed).toContain("本次任务已处理完成");
      await delay(35);
      expect(readFileSync(file, "utf8")).toBe(completed); // 完成后不再产生通知
    } finally {
      await notifier.finish();
    }
  });

  it("失败通知正常发送，结束调用幂等", async () => {
    const file = outputFile();
    const notifier = new TaskNotifier(async (text) => {
      await delay(10);
      await appendFile(file, `${text}\n`, "utf8");
    }, 20);
    notifier.start();
    notifier.update({ stage: "queued" });
    await delay(25);
    await notifier.finish("本次任务处理失败");
    await notifier.finish("不应重复发送");
    const output = readFileSync(file, "utf8");
    expect(output).not.toContain("等待前一条任务完成"); // 进度通知已停用
    expect(output.trim().endsWith("本次任务处理失败")).toBe(true);
    expect(output).not.toContain("不应重复发送");
  });

  it("进度通知停用后，任何阶段与工具名称都不落文本", async () => {
    const file = outputFile();
    const notifier = new TaskNotifier((text) => appendFile(file, `${text}\n`, "utf8"), 20);
    notifier.start();
    notifier.update({ stage: "tool", toolName: "private-provider-tool" });
    await delay(30);
    await notifier.finish();
    expect(() => readFileSync(file, "utf8")).toThrow(); // 全程无输出，工具名不泄露
  });
});
