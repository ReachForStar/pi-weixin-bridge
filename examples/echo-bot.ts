// 最小回声机器人示例：演示 iLink 客户端 + 消息解析/构造模块的直接用法。
// 运行：npx tsx examples/echo-bot.ts
// 收到文本消息后原样回显「Echo: <文本>」。

import { IlinkClient } from "../src/ilink/client.js";
import { SessionTimeoutError } from "../src/ilink/errors.js";
import { loginWithQR } from "../src/ilink/login.js";
import { MessageType } from "../src/ilink/types.js";
import { parseIncomingMessage } from "../src/message/parser.js";
import { buildTextMessage } from "../src/message/builder.js";
import { CONFIG } from "../src/config.js";
import { logger } from "../src/logger/index.js";

async function main() {
  // 1. 扫码登录
  const client = new IlinkClient(CONFIG.fixedBaseUrl);
  const account = await loginWithQR(client);
  client.setToken(account.botToken);
  client.setBaseUrl(account.baseUrl);
  logger.info(`已登录：${account.accountId}`);

  // 2. 长轮询收消息并回显
  let buf = "";
  let timeout = CONFIG.longPollTimeoutMs;
  let consecutiveFailures = 0;
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());

  while (!controller.signal.aborted) {
    try {
      const resp = await client.getUpdates(buf, timeout, controller.signal);
      if (controller.signal.aborted) break;
      if (resp.errcode === -14) throw new SessionTimeoutError();
      if (resp.get_updates_buf) buf = resp.get_updates_buf;
      if (resp.longpolling_timeout_ms) timeout = resp.longpolling_timeout_ms;

      for (const msg of resp.msgs ?? []) {
        if (msg.message_type !== MessageType.USER) continue;
        const incoming = parseIncomingMessage(msg);
        if (!incoming.text || !incoming.fromUserId) continue;
        logger.info(`[in] ${incoming.fromUserId}: ${incoming.text}`);
        // 原样回显（发送失败单独捕获，不干扰轮询循环）
        try {
          await client.sendMessage(
            buildTextMessage(`Echo: ${incoming.text}`, {
              to: incoming.fromUserId,
              contextToken: incoming.contextToken,
            }),
          );
        } catch (sendErr) {
          logger.error(`回复失败: ${String(sendErr)}`);
        }
      }
      consecutiveFailures = 0;
    } catch (err) {
      if (controller.signal.aborted) break;
      if (err instanceof SessionTimeoutError) {
        logger.warn("会话超时，请重新运行以扫码登录");
        break;
      }
      // 与主桥一致：连续失败 5 次后退避升到 30s，避免持久故障高频重试
      consecutiveFailures++;
      const backoff = consecutiveFailures >= 5 ? 30_000 : 3_000;
      logger.error(`错误 (连续 ${consecutiveFailures} 次，${backoff / 1000}s 后重试): ${String(err)}`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  logger.info("已退出");
  // 显式退出：SIGINT 监听器与未关闭的 client 句柄会拖住事件循环
  process.exit(0);
}

main().catch((err) => {
  logger.error(`致命错误: ${String(err)}`);
  process.exit(1);
});
