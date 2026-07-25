import crypto from "node:crypto";
import { CONFIG } from "../config.js";
import type {
  BaseInfo,
  GetUpdatesResp,
  QRCodeResponse,
  QRStatusResponse,
  SendMessageResp,
  WeixinMessage,
} from "./types.js";

/** X-WECHAT-UIN：随机 uint32 → 十进制字符串 → base64 */
function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

/** GET 请求仅用公共头（无 Content-Type / Authorization） */
function buildCommonHeaders(): Record<string, string> {
  return {
    "iLink-App-Id": CONFIG.ilinkAppId,
    "iLink-App-ClientVersion": String(CONFIG.ilinkAppClientVersion),
  };
}

/** POST 请求完整头 */
function buildPostHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    ...buildCommonHeaders(),
  };
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  return headers;
}

function buildBaseInfo(): BaseInfo {
  return {
    channel_version: CONFIG.channelVersion,
    bot_agent: CONFIG.botAgent,
  };
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** 会话超时错误（errcode -14），上层捕获后触发重新登录 */
export class SessionTimeoutError extends Error {
  constructor() {
    super("iLink session timeout (errcode -14)");
    this.name = "SessionTimeoutError";
  }
}

export class IlinkClient {
  private baseUrl: string;
  private token?: string;

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  setToken(token: string): void {
    this.token = token;
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** POST JSON 通用封装 */
  private async post(
    endpoint: string,
    body: unknown,
    timeoutMs: number,
    baseUrl = this.baseUrl,
    signal?: AbortSignal,
  ): Promise<string> {
    const url = new URL(endpoint, ensureTrailingSlash(baseUrl));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // 合并外部 signal（停止服务时立即中断长轮询）
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener("abort", onExternalAbort, { once: true });
    try {
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: buildPostHeaders(this.token),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`POST ${endpoint} HTTP ${res.status}: ${text.slice(0, 200)}`);
      return text;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onExternalAbort);
    }
  }

  /** GET 通用封装（仅公共头） */
  private async get(endpoint: string, timeoutMs: number, baseUrl = this.baseUrl): Promise<string> {
    const url = new URL(endpoint, ensureTrailingSlash(baseUrl));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: buildCommonHeaders(),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`GET ${endpoint} HTTP ${res.status}: ${text.slice(0, 200)}`);
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 获取登录二维码（始终用固定域名，无需 token） */
  async fetchQRCode(localTokenList: string[] = []): Promise<QRCodeResponse> {
    const raw = await this.post(
      `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(CONFIG.botType)}`,
      { local_token_list: localTokenList },
      CONFIG.apiTimeoutMs,
      CONFIG.fixedBaseUrl,
    );
    return JSON.parse(raw) as QRCodeResponse;
  }

  /** 长轮询扫码状态（GET，客户端超时视为 wait 继续轮询） */
  async pollQRStatus(qrcode: string, baseUrl = this.baseUrl, verifyCode?: string): Promise<QRStatusResponse> {
    try {
      let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
      if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
      const raw = await this.get(endpoint, CONFIG.qrPollTimeoutMs, baseUrl);
      return JSON.parse(raw) as QRStatusResponse;
    } catch (err) {
      // 客户端超时或网关错误均视为等待，继续轮询
      if (err instanceof Error && err.name === "AbortError") return { status: "wait" };
      return { status: "wait" };
    }
  }

  /** 长轮询收取消息 */
  async getUpdates(getUpdatesBuf: string, timeoutMs: number, signal?: AbortSignal): Promise<GetUpdatesResp> {
    try {
      const raw = await this.post(
        "ilink/bot/getupdates",
        { get_updates_buf: getUpdatesBuf ?? "", base_info: buildBaseInfo() },
        timeoutMs,
        this.baseUrl,
        signal,
      );
      return JSON.parse(raw) as GetUpdatesResp;
    } catch (err) {
      // 长轮询客户端超时属正常控制流，返回空响应由调用方重试
      if (err instanceof Error && err.name === "AbortError" && !signal?.aborted) {
        return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
      }
      throw err;
    }
  }

  /** 发送消息 */
  async sendMessage(msg: WeixinMessage): Promise<void> {
    const raw = await this.post(
      "ilink/bot/sendmessage",
      { msg, base_info: buildBaseInfo() },
      CONFIG.apiTimeoutMs,
    );
    const resp = JSON.parse(raw) as SendMessageResp;
    if (resp.ret && resp.ret !== 0) {
      throw new Error(`sendMessage ret=${resp.ret} errmsg=${resp.errmsg ?? "(none)"}`);
    }
  }
}
