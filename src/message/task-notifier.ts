import { logger } from "../logger/index.js";

export type TaskProgress =
  | { stage: "queued" | "preparing" | "running" | "retrying" | "converting" | "downloading" }
  | { stage: "tool"; toolName: string }
  | { stage: "tool-completed"; failed: boolean };

const TOOL_LABELS: Record<string, string> = {
  read: "正在读取文件", write: "正在写入文件", edit: "正在修改文件", bash: "正在执行命令",
  grep: "正在搜索内容", find: "正在查找文件", ls: "正在查看目录", send_weixin_image: "正在发送图片",
  send_weixin_file: "正在发送文件", search_weixin_files: "正在检索资料",
};

export class TaskNotifier {
  private readonly started = Date.now();
  private stage = "正在准备任务";
  private completedTools = 0;
  private timer?: ReturnType<typeof setInterval>;
  private pending: Promise<void> = Promise.resolve();
  private closed = false;
  /** 是否已发出过终态文案（结束语/错误/回复），用于决定是否需要兜底结束消息 */
  private ended = false;
  /** 是否曾启动过进度定时器（finish 时定时器可能已被 stopProgress 清掉） */
  private hadTimer = false;

  constructor(private readonly send: (text: string) => Promise<void>, private readonly intervalMs = 30_000) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) throw new RangeError("通知间隔必须为正整数");
  }

  /** 标记本轮已有终态输出（如正文回复），避免 finish() 再追加兜底结束语 */
  markReplied(): void {
    this.ended = true;
  }

  private enqueue(text: string): void {
    // 已关闭后不再接受任何消息：否则定时器最后一跳可能把「仍在进行」排在结束文案之后
    if (this.closed) return;
    this.pending = this.pending.then(() => this.send(text)).catch((error) => {
      // 通知通道故障单独记录，避免把发送故障误报为 Agent 任务失败。
      logger.warn(`[notify] 任务通知发送失败: ${String(error)}`);
    });
  }

  /** finish 专用入队：先入队再关闭，保证结束文案本身能发出 */
  private enqueueFinal(text: string): void {
    this.pending = this.pending.then(() => this.send(text)).catch((error) => {
      logger.warn(`[notify] 任务通知发送失败: ${String(error)}`);
    });
  }

  start(): void {
    if (this.closed || this.timer) return;
    this.enqueue("⏳ 已收到消息，开始处理任务。");
    this.hadTimer = true;
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
      case "downloading": this.stage = "正在下载附件"; break;
      case "tool": this.stage = TOOL_LABELS[progress.toolName] ?? "正在调用工具"; break;
      case "tool-completed":
        this.completedTools++;
        this.stage = progress.failed ? "工具未成功，正在继续处理" : "工具已完成，正在继续处理";
        break;
    }
  }

  /**
   * 结束通知。已 start 但未显式给出结束文案时补发一条兜底消息，
   * 避免「只有开始、没有结束」让用户以为任务卡死（例如停机中断、静默返回等路径）。
   */
  async finish(message?: string): Promise<void> {
    if (this.closed) {
      await this.pending;
      return;
    }
    // 先清定时器再入队结束文案：彻底关掉并发的进度消息来源
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (message) {
      this.ended = true;
      this.enqueueFinal(message);
    } else if (!this.ended && this.hadTimer) {
      // 仅对真正没有输出终态的路径兜底；曾启动过定时器不代表没发过回复
      this.enqueueFinal("✅ 本轮处理已结束。");
    }
    this.closed = true;
    await this.stopProgress();
  }

  async stopProgress(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.hadTimer ||= Boolean(this.timer);
    this.timer = undefined;
    await this.pending;
  }
}
