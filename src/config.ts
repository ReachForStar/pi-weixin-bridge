import { homedir } from "node:os";
import { join } from "node:path";

/** iLink-App-ClientVersion 编码：0x00MMNNPP（major<<16 | minor<<8 | patch） */
function buildClientVersion(version: string): number {
  const parts = version.split(".").map((p) => parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

// 与官方 @tencent-weixin/openclaw-weixin 保持一致的协议标识，确保服务端兼容
const CHANNEL_VERSION = "2.4.6";

/** 状态目录（账号凭据、pi 工作区） */
export const STATE_DIR = process.env.PI_WEIXIN_STATE_DIR || join(homedir(), ".pi-weixin-bridge");
/** 账号凭据持久化文件 */
export const ACCOUNT_FILE = join(STATE_DIR, "account.json");
/** pi 会话的工作目录（Agent 在此目录读写文件） */
export const WORKSPACE = process.env.PI_WEIXIN_WORKSPACE || join(STATE_DIR, "workspace");

export const CONFIG = {
  /** iLink 固定接入域名（扫码登录始终用它） */
  fixedBaseUrl: "https://ilinkai.weixin.qq.com",
  /** 微信 CDN 域名（媒体上传/下载） */
  cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
  ilinkAppId: "bot",
  ilinkAppClientVersion: buildClientVersion(CHANNEL_VERSION),
  channelVersion: CHANNEL_VERSION,
  /** 自我声明的上游身份（类似 User-Agent，仅用于观测） */
  botAgent: "pi-weixin-bridge/1.0.0",
  /** ilink bot_type（当前渠道构建固定为 3） */
  botType: "3",
  /** getUpdates 长轮询超时 */
  longPollTimeoutMs: 35_000,
  /** 普通接口超时（sendMessage 等） */
  apiTimeoutMs: 15_000,
  /** 扫码状态长轮询超时 */
  qrPollTimeoutMs: 35_000,
  /** 登录总超时 */
  loginTimeoutMs: 480_000,
};
