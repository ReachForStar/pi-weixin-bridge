import crypto from "node:crypto";
import { CONFIG } from "../config.js";
import { AuthError, NetworkError, ProtocolError, SessionTimeoutError, classifyFetchError } from "./errors.js";
import type {
  BaseInfo,
  GetConfigResp,
  GetUpdatesResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  QRCodeResponse,
  QRStatusResponse,
  SendMessageResp,
  SendTypingReq,
  WeixinMessage,
} from "./types.js";

// 保留 SessionTimeoutError 导出以兼容旧调用方（现来自 errors.ts）
export { SessionTimeoutError };

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

/** 将 HTTP 非 2xx 响应归类为 AuthError（401/403）或 ProtocolError */
function httpError(endpoint: string, status: number, body: string): AuthError | ProtocolError {
  const snippet = body.slice(0, 200);
  if (status === 401 || status === 403) {
    return new AuthError(`${endpoint} 鉴权失败 HTTP ${status}: ${snippet}`);
  }
  return new ProtocolError(`${endpoint} HTTP ${status}: ${snippet}`, undefined, status);
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
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "POST",
        headers: buildPostHeaders(this.token),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // AbortError（超时/外部中断）原样抛出由调用方处理；其余归类为网络错误
      if ((err as Error)?.name === "AbortError") throw err;
      throw classifyFetchError(err);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onExternalAbort);
    }
    const text = await res.text();
    if (!res.ok) throw httpError(`POST ${endpoint}`, res.status, text);
    return text;
  }

  /** GET 通用封装（仅公共头） */
  private async get(endpoint: string, timeoutMs: number, baseUrl = this.baseUrl): Promise<string> {
    const url = new URL(endpoint, ensureTrailingSlash(baseUrl));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "GET",
        headers: buildCommonHeaders(),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      throw classifyFetchError(err);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) throw httpError(`GET ${endpoint}`, res.status, text);
    return text;
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
      if (resp.ret === -14) throw new SessionTimeoutError();
      throw new ProtocolError(`sendMessage ret=${resp.ret} errmsg=${resp.errmsg ?? "(none)"}`, resp.ret);
    }
  }

  /** 获取机器人配置（含 typing_ticket） */
  async getConfig(ilinkUserId: string, contextToken?: string): Promise<GetConfigResp> {
    const raw = await this.post(
      "ilink/bot/getconfig",
      { ilink_user_id: ilinkUserId, context_token: contextToken, base_info: buildBaseInfo() },
      CONFIG.apiTimeoutMs,
    );
    return JSON.parse(raw) as GetConfigResp;
  }

  /** 发送“正在输入”状态 */
  async sendTyping(body: SendTypingReq): Promise<void> {
    await this.post("ilink/bot/sendtyping", { ...body, base_info: buildBaseInfo() }, CONFIG.apiTimeoutMs);
  }

  /** 获取 CDN 上传预签名 URL */
  async getUploadUrl(req: GetUploadUrlReq): Promise<GetUploadUrlResp> {
    const raw = await this.post(
      "ilink/bot/getuploadurl",
      { ...req, base_info: buildBaseInfo() },
      CONFIG.apiTimeoutMs,
    );
    return JSON.parse(raw) as GetUploadUrlResp;
  }
}
