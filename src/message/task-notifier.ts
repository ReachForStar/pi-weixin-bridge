import { logger } from "../logger/index.js";

export type TaskProgress =
  | { stage: "queued" | "preparing" | "running" | "retrying" | "converting" }
  | { stage: "tool"; toolName: string }
  | { stage: "tool-completed"; failed: boolean };

const TOOL_LABELS: Record<string, string> = {
  read: "正在读取文件", write: "正在写入文件", edit: "正在修改文件", bash: "正在执行命令",
  grep: "正在搜索内容", find: "正在查找文件", ls: "正在查看目录", send_weixin_image: "正在发送图片",
};

export class TaskNotifier {
  private readonly started = Date.now();
  private stage = "正在准备任务";
  private completedTools = 0;
  private timer?: ReturnType<typeof setInterval>;
  private pending: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly send: (text: string) => Promise<void>, private readonly intervalMs = 30_000) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) throw new RangeError("通知间隔必须为正整数");
  }

  private enqueue(text: string): void {
    this.pending = this.pending.then(() => this.send(text)).catch((error) => {
      // 通知通道故障单独记录，避免把发送故障误报为 Agent 任务失败。
      logger.warn(`[notify] 任务通知发送失败: ${String(error)}`);
    });
  }

  start(): void {
    if (this.closed || this.timer) return;
    this.enqueue("⏳ 已收到消息，开始处理任务。");
    this.timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - this.started) / 1000);
      this.enqueue(`⏳ 任务仍在进行\n\n- 进度：${this.stage}\n- 已用时：${seconds} 秒\n- 已结束的工具调用：${this.completedTools} 次`);
    }, this.intervalMs);
  }

  update(progress: TaskProgress): void {
    if (this.closed) return;
    switch (progress.stage) {
      case "queued": this.stage = "等待前一条任务完成"; break;
      case "preparing": this.stage = "正在准备任务"; break;
      case "running": this.stage = "正在生成回复"; break;
      case "retrying": this.stage = "正在重试模型请求"; break;
      case "converting": this.stage = "正在将附件转换为 Markdown"; break;
      case "tool": this.stage = TOOL_LABELS[progress.toolName] ?? "正在调用工具"; break;
      case "tool-completed":
        this.completedTools++;
        this.stage = progress.failed ? "工具未成功，正在继续处理" : "工具已完成，正在继续处理";
        break;
    }
  }

  async finish(message?: string): Promise<void> {
    if (this.closed) {
      await this.pending;
      return;
    }
    this.closed = true;
    if (message) this.enqueue(message);
    await this.stopProgress();
  }

  async stopProgress(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.pending;
  }
}
