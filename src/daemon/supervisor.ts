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
  closeSync,
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
  killProcessTree,
  LOG_ROTATE_BYTES,
  STOP_GRACE_MS,
} from "./daemon.js";
import { acquireProcessLock } from "./process-lock.js";
import { writePidFiles } from "./pid-identity.js";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// 日志轮转阈值复用 daemon.ts 的共享常量，避免两份字面量漂移

export interface SupervisorOptions {
  /** 子进程参数（默认：bin 包装器 start，即桥接服务）；测试可注入任意 node 参数 */
  childArgs?: string[];
  /** PID/日志目录（默认 ~/.pi-weixin-bridge/daemon）；测试注入临时目录 */
  daemonDir?: string;
  baseBackoffMs?: number;
  /** 停止请求后等待子进程退出的宽限期（毫秒）；超时强杀。默认 6 秒，短于 daemon 自身的停止宽限 */
  stopGraceMs?: number;
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
  // 必须短于 daemon stop 的宽限：否则 daemon 先升级强杀 supervisor，子进程收尾尚未完成
  const stopGraceMs = opts.stopGraceMs ?? Math.max(1_000, STOP_GRACE_MS - 2_000);

  mkdirSync(daemonDir, { recursive: true });

  // 重复 supervisor 自保护：并发 `daemon start` 或开机任务与手动启动竞态时，后到者退出
  const release = acquireProcessLock(pidFile);
  // 重启计数：每次 supervisor 启动归零（status 表格显示），崩溃重启时递增
  const restartFile = join(daemonDir, "restarts.count");
  let restarts = 0;

  let stopRequested = false;
  const onSignal = () => { stopRequested = true; };
  if (!opts.shouldStop) {
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  }
  const shouldStop = opts.shouldStop ?? (() => stopRequested);

  let backoff = baseBackoffMs;
  try {
  writeFileSync(restartFile, "0", "utf8");
  while (!shouldStop()) {
    // 每次拉起前检查日志体积，超阈值滚动；失败只降级（Windows 句柄未释放会 EPERM），不中断重启循环
    try {
      if (existsSync(bridgeLog) && statSync(bridgeLog).size > LOG_ROTATE_BYTES) {
        renameSync(bridgeLog, `${bridgeLog}.1`);
      }
    } catch (error) {
      logger.warn(`bridge.log 轮转失败（忽略，旧日志继续追加）：${String(error)}`);
    }
    const logFd = openSync(bridgeLog, "a");
    const startedAt = Date.now();
    const child = spawn(process.execPath, childArgs, {
      cwd: PKG_ROOT,
      windowsHide: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, PI_WEIXIN_HEADLESS: "1" },
    });
    closeSync(logFd);
    // spawn 失败时 child.pid 为 undefined：不写 PID 文件（写 "0" 会被判定为损坏锁）
    writePidFiles(bridgePidFile, child.pid);
    if (child.pid) logger.info(`[supervisor] 桥接进程已启动 pid=${child.pid}`);
    else logger.warn("[supervisor] 桥接进程未能启动（spawn 未返回 pid），等待错误事件");

    const code = await new Promise<number | null>((resolve) => {
      let requested = false;
      let forceTimer: NodeJS.Timeout | undefined;
      const timer = setInterval(() => {
        if (!shouldStop() || requested || !child.pid) return;
        requested = true;
        // 先温和停止：桥接收到 SIGTERM 后要中断模型请求、发送中断通知并释放实例锁。
        // 立即强杀会跳过这些收尾，用户只能看到连接中断。
        try { killProcessTree(child.pid, process.platform === "win32"); }
        catch (error) { logger.error(`[supervisor] 停止子进程失败：${String(error)}`); }
        if (process.platform === "win32") {
          // Windows 没有可投递的 SIGTERM：taskkill 失败时继续重试，直到子进程退出或进程被外部停止
          forceTimer = setTimeout(function retry() {
            if (child.exitCode !== null || child.signalCode !== null) return;
            logger.warn("[supervisor] 桥接未在宽限期内退出，重试强制结束");
            try { killProcessTree(child.pid!, true); }
            catch (error) { logger.error(`[supervisor] 强制停止子进程失败：${String(error)}`); }
            forceTimer = setTimeout(retry, 2_000);
          }, stopGraceMs);
          return;
        }
        logger.info(`[supervisor] 已请求桥接退出，最多等待 ${stopGraceMs >= 1000 ? `${Math.round(stopGraceMs / 1000)} 秒` : `${stopGraceMs} 毫秒`}`);
        forceTimer = setTimeout(() => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          logger.warn("[supervisor] 桥接未在宽限期内退出，强制结束");
          try { killProcessTree(child.pid!, true); }
          catch (error) { logger.error(`[supervisor] 强制停止子进程失败：${String(error)}`); }
        }, stopGraceMs);
      }, 100);
      const finish = (value: number | null) => {
        clearInterval(timer);
        if (forceTimer) clearTimeout(forceTimer);
        resolve(value);
      };
      child.on("error", (error) => { logger.error(`[supervisor] 子进程启动失败：${error.message}`); finish(null); });
      child.on("exit", (c) => finish(c));
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
    restarts += 1;
    writeFileSync(restartFile, String(restarts), "utf8");
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
  } finally {
  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);
  release();
  rmSync(bridgePidFile, { force: true });
  logger.info("[supervisor] 已停止。");
  }
}
