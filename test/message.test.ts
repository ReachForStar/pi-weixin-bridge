import { describe, it, expect } from "vitest";
import { extractText } from "../src/ilink/message.js";
import { MessageItemType } from "../src/ilink/types.js";

describe("extractText 消息正文提取", () => {
  it("提取文本消息", () => {
    const items = [{ type: MessageItemType.TEXT, text_item: { text: "你好" } }];
    expect(extractText(items)).toBe("你好");
  });

  it("提取语音转文字", () => {
    const items = [{ type: MessageItemType.VOICE, voice_item: { text: "语音转写内容" } }];
    expect(extractText(items)).toBe("语音转写内容");
  });

  it("空列表 / undefined 返回空字符串", () => {
    expect(extractText([])).toBe("");
    expect(extractText(undefined)).toBe("");
  });

  it("取首个文本项", () => {
    const items = [
      { type: MessageItemType.IMAGE, image_item: {} },
      { type: MessageItemType.TEXT, text_item: { text: "图片描述" } },
      { type: MessageItemType.TEXT, text_item: { text: "第二段" } },
    ];
    expect(extractText(items)).toBe("图片描述");
  });

  it("无文本内容（纯媒体）返回空", () => {
    const items = [{ type: MessageItemType.IMAGE, image_item: {} }];
    expect(extractText(items)).toBe("");
  });

  it("语音无转写文字返回空", () => {
    const items = [{ type: MessageItemType.VOICE, voice_item: {} }];
    expect(extractText(items)).toBe("");
  });
});
