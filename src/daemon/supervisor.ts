// supervisor 进程：保持桥接子进程存活（崩溃自动重启 + 指数退避），自身由 `daemon start` 以
// detached + windowsHide 拉起（stdio 重定向到 supervisor.log）。
// 子进程统一带 PI_WEIXIN_HEADLESS=1：会话过期时不交互扫码，而是等待终端 `login` 更新账号。
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger/index.js";
import {
  BASE_BACKOFF_MS,
  BIN_PATH,
  DAEMON_DIR,
  isPidAlive,
  nextBackoffMs,
  readPidOrNull,
} from "./daemon.js";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 日志轮转阈值：超过后滚动为 .1（覆盖旧备份，避免后台服务无限增长） */
const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

export interface SupervisorOptions {
  /** 子进程参数（默认：bin 包装器 start，即桥接服务）；测试可注入任意 node 参数 */
  childArgs?: string[];
  /** PID/日志目录（默认 ~/.pi-weixin-bridge/daemon）；测试注入临时目录 */
  daemonDir?: string;
  baseBackoffMs?: number;
  /** 停止判定（默认 SIGINT/SIGTERM 触发）；测试可注入手动标志 */
  shouldStop?: () => boolean;
  /** 子进程退出回调（测试观测用） */
  onChildExit?: (code: number | null, uptimeMs: number) => void;
}

export async function runSupervisor(opts: SupervisorOptions = {}): Promise<void> {
  const daemonDir = opts.daemonDir ?? DAEMON_DIR;
  const pidFile = join(daemonDir, "supervisor.pid");
  const bridgePidFile = join(daemonDir, "bridge.pid");
  const bridgeLog = join(daemonDir, "bridge.log");
  const childArgs = opts.childArgs ?? [BIN_PATH, "start"];
  const baseBackoffMs = opts.baseBackoffMs ?? BASE_BACKOFF_MS;

  mkdirSync(daemonDir, { recursive: true });

  // 重复 supervisor 自保护：并发 `daemon start` 或开机任务与手动启动竞态时，后到者退出
  const existing = readPidOrNull(pidFile);
  if (existing !== null && existing !== process.pid && isPidAlive(existing)) {
    logger.warn(`[supervisor] 已有 supervisor 在运行（pid ${existing}），退出。`);
    return;
  }
  writeFileSync(pidFile, String(process.pid), "utf8");

  let stopRequested = false;
  if (!opts.shouldStop) {
    const onSignal = () => {
      stopRequested = true;
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  }
  const shouldStop = opts.shouldStop ?? (() => stopRequested);

  let backoff = baseBackoffMs;
  while (!shouldStop()) {
    // 每次拉起前检查日志体积，超阈值滚动
    if (existsSync(bridgeLog) && statSync(bridgeLog).size > LOG_ROTATE_BYTES) {
      renameSync(bridgeLog, `${bridgeLog}.1`);
    }
    const logFd = openSync(bridgeLog, "a");
    const startedAt = Date.now();
    const child = spawn(process.execPath, childArgs, {
      cwd: PKG_ROOT,
      windowsHide: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, PI_WEIXIN_HEADLESS: "1" },
    });
    writeFileSync(bridgePidFile, String(child.pid ?? 0), "utf8");
    logger.info(`[supervisor] 桥接进程已启动 pid=${child.pid}`);

    const code = await new Promise<number | null>((resolve) => {
      child.on("error", () => resolve(null));
      child.on("exit", (c) => resolve(c));
    });

    rmSync(bridgePidFile, { force: true });
    opts.onChildExit?.(code, Date.now() - startedAt);
    if (shouldStop()) break;
    if (code === 0) {
      // 干净退出（如手动停止子进程）不重启
      logger.info("[supervisor] 桥接进程正常退出，不再重启。");
      break;
    }
    const uptime = Date.now() - startedAt;
    backoff = nextBackoffMs(backoff, uptime);
    logger.warn(
      `[supervisor] 桥接进程异常退出（code=${code ?? "spawn失败"}），${backoff / 1000}s 后重启`,
    );
    // 退避等待：停止信号/条件到达时立即唤醒（SIGTERM 后不睡满 backoff）
    await new Promise<void>((resolve) => {
      const deadline = Date.now() + backoff;
      const timer = setInterval(() => {
        if (shouldStop() || Date.now() >= deadline) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  }

  rmSync(pidFile, { force: true });
  rmSync(bridgePidFile, { force: true });
  logger.info("[supervisor] 已停止。");
}
