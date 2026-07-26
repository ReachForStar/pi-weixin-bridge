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
  /** 原始消息（供需要完整信息时使用） */
  raw: WeixinMessage;
}

function detectMedia(items?: MessageItem[]) {
  let hasImage = false;
  let hasVoice = false;
  let hasFile = false;
  let hasVideo = false;
  for (const item of items ?? []) {
    if (item.type === MessageItemType.IMAGE) hasImage = true;
    else if (item.type === MessageItemType.VOICE) hasVoice = true;
    else if (item.type === MessageItemType.FILE) hasFile = true;
    else if (item.type === MessageItemType.VIDEO) hasVideo = true;
  }
  return { hasImage, hasVoice, hasFile, hasVideo };
}

/** 解析入站 WeixinMessage */
export function parseIncomingMessage(msg: WeixinMessage): IncomingMessage {
  return {
    fromUserId: msg.from_user_id ?? "",
    sessionId: msg.session_id,
    groupId: msg.group_id,
    contextToken: msg.context_token,
    text: extractText(msg.item_list),
    ...detectMedia(msg.item_list),
    raw: msg,
  };
}

/** 是否为需要处理的用户消息（有文本或媒体） */
export function isProcessable(msg: IncomingMessage): boolean {
  return Boolean(msg.text || msg.hasImage || msg.hasVoice || msg.hasFile || msg.hasVideo);
}
