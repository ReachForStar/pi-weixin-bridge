// 安装向导：交互式选择状态目录与 pi 工作目录，校验可写性后持久化到 config.json。
// 凭据与日志落在用户自选路径，因此写入前必须实际探针验证可写（而非仅 existsSync）。
import { createInterface, type Interface } from "node:readline/promises";
import { closeSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import {
  BOOTSTRAP_DIR,
  CONFIG_FILE,
  STATE_DIR,
  WORKSPACE,
  defaultWorkspace,
  resolveUserPath,
} from "./config.js";
import { hardenStateDir } from "./account.js";
import { logger } from "./logger/index.js";

/**
 * 行读取器：缓存先于 question 到达的行（快速管道/pty 输入不会丢答案），
 * EOF 时把挂起的 question 按空输入结算（回退默认值），避免 Ctrl+D 崩溃。
 */
class LineReader {
  private buffer: string[] = [];
  private waiters: Array<(line: string) => void> = [];
  private closed = false;
  private rl: Interface;

  constructor(input: Readable) {
    this.rl = createInterface({ input, output: process.stdout });
    this.rl.on("line", (line) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter(line);
      else this.buffer.push(line);
    });
    this.rl.on("close", () => {
      this.closed = true;
      const waiting = this.waiters.splice(0);
      for (const w of waiting) w("");
    });
  }

  question(prompt: string): Promise<string> {
    process.stdout.write(prompt);
    if (this.closed) return Promise.resolve("");
    const line = this.buffer.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    this.rl.close();
  }
}

export interface WizardChoice {
  stateDir: string;
  workspace: string;
  /** 是否使用了当前生效的默认值（未做任何修改） */
  fromDefaults: boolean;
}

/** 实际写删探针文件验证目录可写 */
function checkWritable(dir: string): string | null {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.write-test-${process.pid}`);
    const fd = openSync(probe, "w");
    closeSync(fd);
    rmSync(probe);
    return null;
  } catch (err) {
    return String(err);
  }
}

/**
 * 运行安装路径向导：
 * - 交互模式（TTY 且未 --yes）：逐项询问，回车用默认
 * - 非交互（无 TTY 或 --yes）：直接用当前生效值
 * - 两个目录均探针校验可写；结果写入 config.json（供后续进程与 daemon 子进程读取）
 */
export async function runInstallWizard(
  opts: { assumeYes?: boolean; interactive?: boolean; input?: Readable } = {},
): Promise<WizardChoice> {
  // interactive 显式指定时覆盖 TTY 自动检测（供测试与特殊场景）；input 可注入（测试）
  const auto = process.stdout.isTTY === true;
  const interactive = (opts.interactive ?? auto) && !opts.assumeYes;
  let stateDir = STATE_DIR;
  let workspace = WORKSPACE;

  if (interactive) {
    const input = opts.input ?? process.stdin;
    const reader = new LineReader(input);
    try {
      const s = await reader.question(
        `① 状态目录（账号凭据、会话上下文、后台日志）\n   默认: ${STATE_DIR}\n   回车使用默认，输入其他路径: `,
      );
      stateDir = s.trim() ? resolveUserPath(s) : STATE_DIR;
      const w = await reader.question(
        `② pi 工作目录（Agent 在此读写文件）\n   默认: ${WORKSPACE}\n   回车使用默认: `,
      );
      workspace = w.trim() ? resolveUserPath(w) : WORKSPACE;
    } finally {
      reader.close();
    }
    if (process.env.PI_WEIXIN_STATE_DIR || process.env.PI_WEIXIN_WORKSPACE) {
      logger.warn(
        "[install] 检测到 PI_WEIXIN_STATE_DIR / PI_WEIXIN_WORKSPACE 环境变量已设置，运行时环境变量优先于 config.json",
      );
    }
  } else {
    logger.info(
      `[install] 使用默认路径（${opts.assumeYes ? "--yes" : "非交互模式"}）：状态目录 ${STATE_DIR}，工作目录 ${WORKSPACE}`,
    );
  }

  for (const [label, dir] of [
    ["状态目录", stateDir],
    ["pi 工作目录", workspace],
  ] as const) {
    const err = checkWritable(dir);
    if (err) {
      throw new Error(`${label}不可写：${dir}\n   ${err}\n   请换一个有写权限的目录（或检查磁盘/权限设置）后重试。`);
    }
  }

  // 凭据所在目录，POSIX 下收紧为 700（探针刚创建/确认了目录存在）
  hardenStateDir();

  // 持久化（引导目录固定，即使状态目录被自定义也能被后续进程发现）
  mkdirSync(BOOTSTRAP_DIR, { recursive: true });
  const settings = {
    stateDir: stateDir === BOOTSTRAP_DIR ? undefined : stateDir,
    workspace: workspace === defaultWorkspace() ? undefined : workspace,
  };
  writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2), "utf8");
  logger.info(
    `[install] 路径已配置：状态目录 ${stateDir}，工作目录 ${workspace}（${existsSync(CONFIG_FILE) ? CONFIG_FILE : "默认"}）`,
  );

  return { stateDir, workspace, fromDefaults: stateDir === STATE_DIR && workspace === WORKSPACE };
}
