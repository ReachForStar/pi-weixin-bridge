// 出站消息构造：构造用于回复的 WeixinMessage（文本 / 图片）。

import crypto from "node:crypto";
import {
  MessageItemType,
  MessageState,
  MessageType,
  type MessageItem,
  type WeixinMessage,
} from "../ilink/types.js";
import type { UploadedInfo } from "../ilink/media.js";

/** 生成消息 client_id（幂等去重用） */
export function generateClientId(): string {
  return `pi-weixin-bridge:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

interface BaseReplyOptions {
  to: string;
  contextToken?: string;
  clientId?: string;
}

/** 构造文本回复消息 */
export function buildTextMessage(text: string, options: BaseReplyOptions): WeixinMessage {
  return {
    from_user_id: "",
    to_user_id: options.to,
    client_id: options.clientId ?? generateClientId(),
    message_type: MessageType.BOT,
    message_state: MessageState.FINISH,
    item_list: [{ type: MessageItemType.TEXT, text_item: { text } }],
    context_token: options.contextToken,
  };
}

/** 构造图片消息（需先经 uploadImage 上传得到 UploadedInfo） */
export function buildImageMessage(uploaded: UploadedInfo, options: BaseReplyOptions): WeixinMessage {
  const imageItem: MessageItem = {
    type: MessageItemType.IMAGE,
    image_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        // aes_key 字段为 base64(hex 字符串的 ASCII)，与入站 parseAesKey 的 hex 分支对应
        aes_key: Buffer.from(uploaded.aeskeyHex).toString("base64"),
        encrypt_type: 1,
      },
      mid_size: uploaded.fileSizeCiphertext,
    },
  };
  return {
    from_user_id: "",
    to_user_id: options.to,
    client_id: options.clientId ?? generateClientId(),
    message_type: MessageType.BOT,
    message_state: MessageState.FINISH,
    item_list: [imageItem],
    context_token: options.contextToken,
  };
}

/** 构造文件消息（需先经 uploadFile 上传） */
export function buildFileMessage(
  uploaded: UploadedInfo,
  fileName: string,
  options: BaseReplyOptions,
): WeixinMessage {
  const fileItem: MessageItem = {
    type: MessageItemType.FILE,
    file_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(uploaded.aeskeyHex).toString("base64"),
        encrypt_type: 1,
      },
      file_name: fileName,
      len: String(uploaded.fileSize),
    },
  };
  return {
    from_user_id: "",
    to_user_id: options.to,
    client_id: options.clientId ?? generateClientId(),
    message_type: MessageType.BOT,
    message_state: MessageState.FINISH,
    item_list: [fileItem],
    context_token: options.contextToken,
  };
}

/** 构造视频消息（需先经 uploadVideo 上传） */
export function buildVideoMessage(uploaded: UploadedInfo, options: BaseReplyOptions): WeixinMessage {
  const videoItem: MessageItem = {
    type: MessageItemType.VIDEO,
    video_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(uploaded.aeskeyHex).toString("base64"),
        encrypt_type: 1,
      },
      video_size: uploaded.fileSizeCiphertext,
    },
  };
  return {
    from_user_id: "",
    to_user_id: options.to,
    client_id: options.clientId ?? generateClientId(),
    message_type: MessageType.BOT,
    message_state: MessageState.FINISH,
    item_list: [videoItem],
    context_token: options.contextToken,
  };
}
