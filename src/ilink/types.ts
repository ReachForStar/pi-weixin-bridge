// iLink 协议类型定义（对照官方 src/api/types.ts）

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

/** 上传媒体类型 */
export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;

/** 输入状态：1=正在输入，2=取消 */
export const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const;

/** 每个请求体携带的基础信息 */
export interface BaseInfo {
  channel_version?: string;
  bot_agent?: string;
}

export interface TextItem {
  text?: string;
}

/** CDN 媒体引用 */
export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  /** 加密类型：0=只加密 fileid，1=打包缩略图/中图等信息 */
  encrypt_type?: number;
  /** 完整下载 URL（服务端直接返回，无需客户端拼接） */
  full_url?: string;
}

export interface ImageItem {
  media?: CDNMedia;
  thumb_media?: CDNMedia;
  /** 原图 AES-128 key 的 hex 字符串（16 字节），入站解密优先于 media.aes_key */
  aeskey?: string;
  url?: string;
  mid_size?: number;
  thumb_size?: number;
}

export interface VoiceItem {
  media?: CDNMedia;
  encode_type?: number;
  sample_rate?: number;
  /** 语音长度（毫秒） */
  playtime?: number;
  /** 语音转文字内容（服务端 STT） */
  text?: string;
}

export interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  md5?: string;
  len?: string;
}

export interface VideoItem {
  media?: CDNMedia;
  video_size?: number;
  play_length?: number;
  thumb_media?: CDNMedia;
}

export interface MessageItem {
  type?: number;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
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

// ---- 上传 ----

export interface GetUploadUrlReq {
  filekey?: string;
  media_type?: number;
  to_user_id?: string;
  /** 原文件明文大小 */
  rawsize?: number;
  /** 原文件明文 MD5 */
  rawfilemd5?: string;
  /** 原文件密文大小（AES-128-ECB 加密后） */
  filesize?: number;
  /** 不需要缩略图上传 URL */
  no_need_thumb?: boolean;
  /** 加密 key（hex） */
  aeskey?: string;
}

export interface GetUploadUrlResp {
  ret?: number;
  errmsg?: string;
  /** 原图上传加密参数 */
  upload_param?: string;
  /** 完整上传 URL（服务端直接返回，无需客户端拼接） */
  upload_full_url?: string;
}

// ---- 输入状态 / 配置 ----

export interface GetConfigResp {
  ret?: number;
  errmsg?: string;
  /** base64 编码的 typing ticket，用于 sendTyping */
  typing_ticket?: string;
}

export interface SendTypingReq {
  ilink_user_id?: string;
  typing_ticket?: string;
  /** 1=正在输入，2=取消 */
  status?: number;
}

// ---- 登录 ----

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
