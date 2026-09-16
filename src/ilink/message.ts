import { MessageItemType, type MessageItem } from "./types.js";

/** 从 item_list 提取正文文本（含语音转文字） */
export function extractText(items?: MessageItem[]): string {
  if (!items?.length) return "";
  for (const item of items) {
    // 空文本跳过（避免空 TEXT 项挡住后面的语音转文字）
    const text = item.text_item?.text;
    if (item.type === MessageItemType.TEXT && text != null && text.trim()) {
      return String(text);
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}
