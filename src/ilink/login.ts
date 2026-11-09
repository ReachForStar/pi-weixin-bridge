import qrcode from "qrcode-terminal";
import { setTimeout as delay } from "node:timers/promises";
import { IlinkClient } from "./client.js";
import { CONFIG } from "../config.js";

/** 持久化的账号凭据 */
export interface AccountState {
  botToken: string;
  accountId: string;
  baseUrl: string;
  userId?: string;
}

const MAX_QR_REFRESH = 3;

function showQR(qrcodeUrl: string): void {
  process.stdout.write("\n请用手机微信扫描以下二维码连接：\n");
  qrcode.generate(qrcodeUrl, { small: true });
  process.stdout.write(`（若无法扫码，可打开链接：${qrcodeUrl}）\n\n`);
}

async function readLine(prompt: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const { createInterface } = await import("node:readline/promises");
  // 动态 import 期间可能已经收到退出信号；此时再注册监听不会触发任何事件
  signal?.throwIfAborted();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // 退出信号到达时关闭 readline：挂起的 question 必须以 AbortError 结束，
  // 否则停止服务时仍会卡在等待输入上（Ctrl+C 看不到反应）。
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => { rl.close(); rejectAbort?.(signal?.reason); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return (await Promise.race([rl.question(prompt), aborted])).trim();
  } finally {
    signal?.removeEventListener("abort", onAbort);
    rl.close();
  }
}

/**
 * 扫码登录：获取二维码 → 长轮询状态 → 返回 bot_token。
 * 处理 IDC 重定向（scaned_but_redirect）、二维码过期刷新、配对码（need_verifycode）。
 * signal 让停止服务时的 Ctrl+C/SIGTERM 能立即结束轮询与输入等待。
 */
export async function loginWithQR(client: IlinkClient, signal?: AbortSignal): Promise<AccountState> {
  let qr = await client.fetchQRCode(undefined, signal);
  let pollBaseUrl = CONFIG.fixedBaseUrl;
  showQR(qr.qrcode_img_content);

  const deadline = Date.now() + CONFIG.loginTimeoutMs;
  let refreshCount = 0;
  let pendingVerifyCode: string | undefined;
  let scannedPrinted = false;

  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const status = await client.pollQRStatus(qr.qrcode, pollBaseUrl, pendingVerifyCode, signal);

    switch (status.status) {
      case "wait":
        break;

      case "scaned":
        if (!scannedPrinted) {
          process.stdout.write("[login] 已扫码，正在验证...\n");
          scannedPrinted = true;
        }
        pendingVerifyCode = undefined;
        break;

      case "need_verifycode": {
        const prompt = pendingVerifyCode
          ? "❌ 数字不匹配，请重新输入微信显示的数字："
          : "请输入手机微信显示的数字以继续连接：";
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("登录超时，请重试");
        const timeout = AbortSignal.timeout(remaining);
        let input: string;
        try {
          input = await readLine(prompt, signal ? AbortSignal.any([signal, timeout]) : timeout);
        } catch (error) {
          if ((error as Error)?.name === "TimeoutError") throw new Error("登录超时，请重试");
          throw error;
        }
        if (!input) {
          process.stdout.write("输入不能为空，请重新输入。\n");
          pendingVerifyCode = undefined;
          continue;
        }
        pendingVerifyCode = input;
        continue; // 立即带配对码进入下一次轮询
      }

      case "scaned_but_redirect":
        // IDC 调度：切换轮询主机
        if (status.redirect_host) {
          pollBaseUrl = `https://${status.redirect_host}`;
        }
        break;

      case "expired": {
        refreshCount++;
        if (refreshCount > MAX_QR_REFRESH) {
          throw new Error("二维码多次过期，登录终止，请重试");
        }
        process.stdout.write(`\n[login] 二维码已过期，刷新中（${refreshCount}/${MAX_QR_REFRESH}）...\n`);
        qr = await client.fetchQRCode(undefined, signal);
        pollBaseUrl = CONFIG.fixedBaseUrl;
        scannedPrinted = false;
        pendingVerifyCode = undefined;
        showQR(qr.qrcode_img_content);
        break;
      }

      case "verify_code_blocked":
        throw new Error("多次输入错误，登录被阻断，请稍后重试");

      case "binded_redirect":
        throw new Error("该微信已绑定过此实例，无需重复连接（如需强制重连请删除账号文件）");

      case "confirmed": {
        if (!status.bot_token || !status.ilink_bot_id) {
          throw new Error("登录确认但服务端未返回 bot_token / ilink_bot_id");
        }
        process.stdout.write("\n✅ 登录成功，已连接到微信。\n");
        return {
          botToken: status.bot_token,
          accountId: status.ilink_bot_id,
          baseUrl: status.baseurl || pollBaseUrl,
          userId: status.ilink_user_id,
        };
      }
    }

    await delay(1000, undefined, { signal });
  }

  throw new Error("登录超时，请重试");
}
