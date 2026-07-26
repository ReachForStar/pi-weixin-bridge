// iLink 错误类型分类，便于上层统一处理（如鉴权失效自动重登）。

/** iLink 错误基类 */
export class IlinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IlinkError";
  }
}

/** 网络层错误（DNS / TCP / TLS / 超时），通常可重试 */
export class NetworkError extends IlinkError {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

/**
 * 鉴权错误（token 失效 / 无权限）。
 * 上层捕获后应触发重新扫码登录。
 */
export class AuthError extends IlinkError {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * 协议 / API 错误（服务端返回非 0 ret 或非 2xx）。
 * errcode -14 表示会话超时（需重登），由上层据此判断。
 */
export class ProtocolError extends IlinkError {
  constructor(
    message: string,
    public readonly errcode?: number,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ProtocolError";
  }

  /** 会话超时（errcode -14），需要重新登录 */
  get isSessionTimeout(): boolean {
    return this.errcode === -14;
  }
}

/** 会话超时错误（errcode -14），保留以兼容旧调用方；是 ProtocolError 的特例 */
export class SessionTimeoutError extends ProtocolError {
  constructor() {
    super("iLink session timeout (errcode -14)", -14);
    this.name = "SessionTimeoutError";
  }
}

/** 将 fetch 层异常归类为 NetworkError */
export function classifyFetchError(err: unknown): NetworkError {
  const cause = (err as NodeJS.ErrnoException)?.cause ?? err;
  const text = String(cause ?? err);
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) return new NetworkError(`DNS 解析失败: ${text}`, err);
  if (/ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/i.test(text))
    return new NetworkError(`连接失败: ${text}`, err);
  if (/SSL|TLS|CERT/i.test(text)) return new NetworkError(`TLS 握手失败: ${text}`, err);
  if ((err as Error)?.name === "AbortError") return new NetworkError("请求超时", err);
  return new NetworkError(`网络错误: ${text}`, err);
}
