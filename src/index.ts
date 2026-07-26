import { CONFIG } from "./config.js";
import { IlinkClient, SessionTimeoutError } from "./ilink/client.js";
import { loginWithQR, type AccountState } from "./ilink/login.js";
import { loadState, saveState } from "./account.js";
import { PiSessionManager } from "./pi/sessions.js";
import { Bridge } from "./bridge.js";

async function doLogin(client: IlinkClient): Promise<AccountState> {
  console.log("[main] 开始扫码登录...");
  const state = await loginWithQR(client);
  saveState(state);
  return state;
}

async function main(): Promise<void> {
  const pi = new PiSessionManager();
  console.log("[main] 初始化 pi 会话管理器...");
  await pi.init();

  let state = loadState();
  const client = new IlinkClient(state?.baseUrl ?? CONFIG.fixedBaseUrl, state?.botToken);

  if (!state?.botToken) {
    state = await doLogin(client);
  } else {
    console.log(`[main] 复用已保存账号 ${state.accountId}`);
  }
  client.setToken(state.botToken);
  client.setBaseUrl(state.baseUrl);

  const controller = new AbortController();
  const shutdown = () => {
    console.log("\n[main] 收到退出信号，正在停止...");
    controller.abort();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    while (!controller.signal.aborted) {
      try {
        const bridge = new Bridge(client, pi);
        await bridge.run(controller.signal);
        break; // 正常退出（被 abort）
      } catch (err) {
        if (controller.signal.aborted) break;
        if (err instanceof SessionTimeoutError) {
          console.log("[main] 会话已过期，重新扫码登录...");
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
    console.log("[main] 已退出。");
  }
}

main().catch((err) => {
  console.error("[main] 致命错误:", err);
  process.exit(1);
});
