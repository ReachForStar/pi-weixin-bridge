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
  it("阶段更新节流，完成后不再产生通知", async () => {
    const file = outputFile();
    const notifier = new TaskNotifier((text) => appendFile(file, `${text}\n`, "utf8"), 20);
    notifier.start();
    notifier.update({ stage: "tool", toolName: "bash" });
    try {
      await delay(55);
      await notifier.stopProgress();
      const progress = readFileSync(file, "utf8");
      expect(progress).toContain("正在执行命令");
      notifier.update({ stage: "tool-completed", failed: false });
      await notifier.finish("本次任务已处理完成");
      const completed = readFileSync(file, "utf8");
      expect(completed).toContain("本次任务已处理完成");
      await delay(35);
      expect(readFileSync(file, "utf8")).toBe(completed);
    } finally {
      await notifier.finish();
    }
  });

  it("失败通知在已排队进度之后发送，结束调用幂等", async () => {
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
    expect(output).toContain("等待前一条任务完成");
    expect(output.trim().endsWith("本次任务处理失败")).toBe(true);
    expect(output).not.toContain("不应重复发送");
  });

  it("未知工具只显示通用阶段，通知不包含工具名称", async () => {
    const file = outputFile();
    const notifier = new TaskNotifier((text) => appendFile(file, `${text}\n`, "utf8"), 20);
    notifier.start();
    notifier.update({ stage: "tool", toolName: "private-provider-tool" });
    await delay(30);
    await notifier.finish();
    const output = readFileSync(file, "utf8");
    expect(output).toContain("正在调用工具");
    expect(output).not.toContain("private-provider-tool");
  });
});
