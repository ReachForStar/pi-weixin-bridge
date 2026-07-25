import qrcode from "qrcode-terminal";
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

async function readLine(prompt: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question(prompt);
  rl.close();
  return ans.trim();
}

/**
 * 扫码登录：获取二维码 → 长轮询状态 → 返回 bot_token。
 * 处理 IDC 重定向（scaned_but_redirect）、二维码过期刷新、配对码（need_verifycode）。
 */
export async function loginWithQR(client: IlinkClient): Promise<AccountState> {
  let qr = await client.fetchQRCode();
  let pollBaseUrl = CONFIG.fixedBaseUrl;
  showQR(qr.qrcode_img_content);

  const deadline = Date.now() + CONFIG.loginTimeoutMs;
  let refreshCount = 0;
  let pendingVerifyCode: string | undefined;
  let scannedPrinted = false;

  while (Date.now() < deadline) {
    const status = await client.pollQRStatus(qr.qrcode, pollBaseUrl, pendingVerifyCode);

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
        pendingVerifyCode = await readLine(prompt);
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
        qr = await client.fetchQRCode();
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

    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error("登录超时，请重试");
}
