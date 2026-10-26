import { MessageItemType, type MessageItem } from "./types.js";

/** 从 item_list 提取正文文本（含语音转文字） */
export function extractText(items?: MessageItem[]): string {
  if (!items?.length) return "";
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    // 空文本跳过（避免空 TEXT 项挡住后面的语音转文字）
    const text = item.text_item?.text;
    // 只接受真正的字符串：盲目 String() 会把畸形对象转成 "[object Object]" 当正文
    if (item.type === MessageItemType.TEXT && typeof text === "string" && text.trim()) {
      return text;
    }
    // 语音转文字可能以非字符串形式出现，统一转字符串避免返回非 string 值
    const voice = item.voice_item?.text;
    if (item.type === MessageItemType.VOICE && typeof voice === "string" && voice.trim()) {
      return voice;
    }
  }
  return "";
}
