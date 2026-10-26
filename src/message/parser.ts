// 入站消息解析：把原始 WeixinMessage 解析为结构化的 IncomingMessage。

import { MessageItemType, type MessageItem, type WeixinMessage } from "../ilink/types.js";
import { extractText } from "../ilink/message.js";

export interface IncomingMessage {
  fromUserId: string;
  sessionId?: string;
  groupId?: string;
  contextToken?: string;
  /** 提取的正文（文本消息或语音转文字） */
  text: string;
  hasImage: boolean;
  hasVoice: boolean;
  hasFile: boolean;
  hasVideo: boolean;
  /** 已归一化的媒体项：下游（如媒体下载）必须消费这个数组，而不是 raw.item_list */
  items: MessageItem[];
  /** 原始消息（供需要完整信息时使用） */
  raw: WeixinMessage;
}

/** 把不可信的 item_list 规范化为数组：非数组/含非对象元素时安全降级，避免下游抛 TypeError */
export function normalizeItems(items: unknown): MessageItem[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is MessageItem => Boolean(item) && typeof item === "object");
}

function detectMedia(items: MessageItem[]) {
  let hasImage = false;
  let hasVoice = false;
  let hasFile = false;
  let hasVideo = false;
  for (const item of items) {
    if (item.type === MessageItemType.IMAGE) hasImage = true;
    else if (item.type === MessageItemType.VOICE) hasVoice = true;
    else if (item.type === MessageItemType.FILE) hasFile = true;
    else if (item.type === MessageItemType.VIDEO) hasVideo = true;
  }
  return { hasImage, hasVoice, hasFile, hasVideo };
}

/**
 * 解析入站 WeixinMessage。
 * 字段全部来自外部协议，可能缺失或类型不符：这里统一做类型归一，
 * 使畸形消息退化为「空消息」而不是抛异常（抛异常会被上层只记日志，消息永久丢失且用户无反馈）。
 */
export function parseIncomingMessage(msg: WeixinMessage): IncomingMessage {
  const items = normalizeItems(msg.item_list);
  return {
    fromUserId: typeof msg.from_user_id === "string" ? msg.from_user_id : "",
    sessionId: typeof msg.session_id === "string" ? msg.session_id : undefined,
    groupId: typeof msg.group_id === "string" ? msg.group_id : undefined,
    contextToken: typeof msg.context_token === "string" ? msg.context_token : undefined,
    text: extractText(items),
    ...detectMedia(items),
    items,
    raw: msg,
  };
}

/** 是否为需要处理的用户消息（有文本或媒体） */
export function isProcessable(msg: IncomingMessage): boolean {
  return Boolean(msg.text || msg.hasImage || msg.hasVoice || msg.hasFile || msg.hasVideo);
}
