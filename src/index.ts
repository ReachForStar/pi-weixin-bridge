import { join } from "node:path";
import { CONFIG, STATE_DIR } from "./config.js";
import { IlinkClient, SessionTimeoutError } from "./ilink/client.js";
import { AuthError } from "./ilink/errors.js";
import { loginWithQR, type AccountState } from "./ilink/login.js";
import { ContextStore } from "./ilink/context-store.js";
import { loadState, saveState } from "./account.js";
import { PiSessionManager } from "./pi/sessions.js";
import { Bridge } from "./bridge.js";
import { logger } from "./logger/index.js";

async function doLogin(client: IlinkClient): Promise<AccountState> {
  logger.info("[main] 开始扫码登录...");
  const state = await loginWithQR(client);
  saveState(state);
  return state;
}

async function main(): Promise<void> {
  const pi = new PiSessionManager();
  logger.info("[main] 初始化 pi 会话管理器...");
  await pi.init();

  // context_token / typing ticket 持久化（重启可恢复，支持主动推送）
  const contextStore = new ContextStore(join(STATE_DIR, "context.json"));

  let state = loadState();
  const client = new IlinkClient(state?.baseUrl ?? CONFIG.fixedBaseUrl, state?.botToken);

  if (!state?.botToken) {
    state = await doLogin(client);
  } else {
    logger.info(`[main] 复用已保存账号 ${state.accountId}`);
  }
  client.setToken(state.botToken);
  client.setBaseUrl(state.baseUrl);

  const controller = new AbortController();
  const shutdown = () => {
    logger.info("[main] 收到退出信号，正在停止...");
    controller.abort();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    while (!controller.signal.aborted) {
      try {
        const bridge = new Bridge(client, pi, contextStore);
        await bridge.run(controller.signal);
        break; // 正常退出（被 abort）
      } catch (err) {
        if (controller.signal.aborted) break;
        // 会话超时 / 鉴权失效 → 重新扫码登录
        if (err instanceof SessionTimeoutError || err instanceof AuthError) {
          logger.warn(`[main] ${err instanceof AuthError ? "鉴权失效" : "会话已过期"}，重新扫码登录...`);
          state = await doLogin(client);
          client.setToken(state.botToken);
          client.setBaseUrl(state.baseUrl);
          continue;
        }
        throw err;
      }
    }
  } finally {
    pi.dispose();
    logger.info("[main] 已退出。");
  }
}

main().catch((err) => {
  logger.error(`[main] 致命错误: ${String(err)}`);
  process.exit(1);
});
