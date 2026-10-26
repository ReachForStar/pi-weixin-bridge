import { join } from "node:path";
import { CONFIG, STATE_DIR } from "./config.js";
import { IlinkClient, SessionTimeoutError } from "./ilink/client.js";
import { AuthError } from "./ilink/errors.js";
import { loginWithQR, type AccountState } from "./ilink/login.js";
import { ContextStore } from "./ilink/context-store.js";
import { loadState, saveState, waitForAccountChange } from "./account.js";
import { PiSessionManager } from "./pi/sessions.js";
import { Bridge } from "./bridge.js";
import { logger } from "./logger/index.js";
import { mkdirSync } from "node:fs";
import { acquireProcessLock } from "./daemon/process-lock.js";
import { scopeId, saveJson } from "./features/state.js";

/** 退出信号是否已触发（区分“信号导致的等待中断”与真正的致命错误） */
let shuttingDown = false;

async function doLogin(client: IlinkClient): Promise<AccountState> {
  logger.info("[main] 开始扫码登录...");
  const state = await loginWithQR(client);
  saveState(state);
  return state;
}

/** 后台模式重登：无法交互扫码，等待用户在终端跑 login 命令更新 account.json 后继续 */
async function waitForHeadlessLogin(
  prev: AccountState | null,
  signal: AbortSignal,
): Promise<AccountState> {
  saveJson(join(STATE_DIR, "daemon", "runtime.json"), { state: "waiting-login", pid: process.pid, updatedAt: Date.now() });
  logger.warn(
    "[main] 后台模式无法扫码。请在终端运行 `pi-weixin-bridge login` 重新扫码，扫码完成后服务自动恢复（后台等待中...）",
  );
  const state = await waitForAccountChange(prev, signal);
  logger.info(`[main] 检测到新账号 ${state.accountId}，恢复服务`);
  return state;
}

async function main(): Promise<void> {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const release = acquireProcessLock(join(STATE_DIR, "instance.pid"));
  const controller = new AbortController();
  const shutdown = () => {
    shuttingDown = true;
    logger.info("[main] 收到退出信号，正在停止...");
    controller.abort();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  const pi = new PiSessionManager();
  try {
  saveJson(join(STATE_DIR, "daemon", "runtime.json"), { state: "initializing", pid: process.pid, updatedAt: Date.now() });
  logger.info("[main] 初始化 pi 会话管理器...");
  await pi.init();

  // context_token / typing ticket 持久化（重启可恢复，支持主动推送）

  // 后台模式（daemon 拉起 / 非 TTY）：会话过期时不交互扫码，改为等待终端重扫
  const headless = process.env.PI_WEIXIN_HEADLESS === "1" || !process.stdout.isTTY;


  let state = loadState();
  const client = new IlinkClient(state?.baseUrl ?? CONFIG.fixedBaseUrl, state?.botToken);

  if (!state?.botToken) {
    state = headless
      ? await waitForHeadlessLogin(null, controller.signal)
      : await doLogin(client);
  } else {
    logger.info(`[main] 复用已保存账号 ${state.accountId}`);
  }
  client.setToken(state.botToken);
  client.setBaseUrl(state.baseUrl);

    while (!controller.signal.aborted) {
      try {
        const contextStore = new ContextStore(join(STATE_DIR, "contexts", `${scopeId(state.accountId)}.json`));
        saveJson(join(STATE_DIR, "daemon", "runtime.json"), { state: "running", pid: process.pid, updatedAt: Date.now() });
        const bridge = new Bridge(client, pi, contextStore, state.accountId);
        await bridge.run(controller.signal);
        break; // 正常退出（被 abort）
      } catch (err) {
        if (controller.signal.aborted) break;
        // 会话超时 / 鉴权失效 → 重新登录（后台模式等待终端重扫，前台模式交互扫码）
        if (err instanceof SessionTimeoutError || err instanceof AuthError) {
          if (!headless) {
            logger.warn(`[main] ${err instanceof AuthError ? "鉴权失效" : "会话已过期"}，重新扫码登录...`);
          }
          state = headless
            ? await waitForHeadlessLogin(state, controller.signal)
            : (await doLogin(client));
          client.setToken(state.botToken);
          client.setBaseUrl(state.baseUrl);
          continue;
        }
        throw err;
      }
    }
  } finally {
    controller.abort();
    pi.dispose();
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    try { saveJson(join(STATE_DIR, "daemon", "runtime.json"), { state: "stopped", pid: process.pid, updatedAt: Date.now() }); }
    finally { release(); }
    logger.info("[main] 已退出。");
  }
}

main().catch((err) => {
  // 退出信号触发的等待中断属于正常停机（finally 已记录退出），不记为致命错误
  if (shuttingDown) return;
  logger.error(`[main] 致命错误: ${String(err)}`);
  process.exit(1);
});
