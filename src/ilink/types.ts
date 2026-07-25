// iLink 协议类型定义（MVP 文本对话所需子集，对照官方 src/api/types.ts）

export const MessageType = {
  NONE: 0,
  USER: 1, // 入站用户消息
  BOT: 2, // 机器人自身消息
} as const;

export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
  TOOL_CALL_START: 11,
  TOOL_CALL_RESULT: 12,
} as const;

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

/** 每个请求体携带的基础信息 */
export interface BaseInfo {
  channel_version?: string;
  bot_agent?: string;
}

export interface TextItem {
  text?: string;
}

export interface MessageItem {
  type?: number;
  text_item?: TextItem;
  // MVP 仅处理文本，媒体项暂不展开
  [key: string]: unknown;
}

/** 统一消息结构（proto: WeixinMessage） */
export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  /** 回复时必须原样带回，否则消息无法归属正确会话 */
  context_token?: string;
  run_id?: string;
}

export interface GetUpdatesResp {
  ret?: number;
  /** 服务端错误码（-14 = 会话超时，需重新登录） */
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  /** 全量上下文 buf，本地缓存并在下次请求带回 */
  get_updates_buf?: string;
  /** 服务端建议的下次长轮询超时（ms） */
  longpolling_timeout_ms?: number;
}

export interface SendMessageReq {
  msg?: WeixinMessage;
}

export interface SendMessageResp {
  ret?: number;
  errmsg?: string;
}

/** 获取二维码响应 */
export interface QRCodeResponse {
  qrcode: string;
  /** 二维码链接（用于终端渲染 / 备用打开） */
  qrcode_img_content: string;
}

/** 扫码状态响应 */
export interface QRStatusResponse {
  qrcode?: string;
  status:
    | "wait"
    | "scaned"
    | "confirmed"
    | "expired"
    | "scaned_but_redirect"
    | "need_verifycode"
    | "verify_code_blocked"
    | "binded_redirect";
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  /** 登录成功后的实际 API 域名（可能因 IDC 调度与固定域名不同） */
  baseurl?: string;
  /** scaned_but_redirect 时切换轮询主机 */
  redirect_host?: string;
}
