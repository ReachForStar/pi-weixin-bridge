import { describe, it, expect } from "vitest";
import { parseIncomingMessage, isProcessable } from "../src/message/parser.js";
import { MessageItemType, MessageType } from "../src/ilink/types.js";

describe("parseIncomingMessage", () => {
  it("解析文本消息", () => {
    const msg = parseIncomingMessage({
      from_user_id: "user-1",
      session_id: "sess-1",
      context_token: "ctx-1",
      message_type: MessageType.USER,
      item_list: [{ type: MessageItemType.TEXT, text_item: { text: "你好" } }],
    });
    expect(msg.fromUserId).toBe("user-1");
    expect(msg.sessionId).toBe("sess-1");
    expect(msg.contextToken).toBe("ctx-1");
    expect(msg.text).toBe("你好");
    expect(msg.hasImage).toBe(false);
  });

  it("检测媒体类型", () => {
    const msg = parseIncomingMessage({
      from_user_id: "u",
      item_list: [
        { type: MessageItemType.IMAGE, image_item: {} },
        { type: MessageItemType.FILE, file_item: {} },
      ],
    });
    expect(msg.hasImage).toBe(true);
    expect(msg.hasFile).toBe(true);
    expect(msg.hasVideo).toBe(false);
  });

  it("空消息字段安全处理", () => {
    const msg = parseIncomingMessage({});
    expect(msg.fromUserId).toBe("");
    expect(msg.text).toBe("");
    expect(msg.contextToken).toBeUndefined();
  });
});

describe("isProcessable", () => {
  it("有文本则可处理", () => {
    expect(isProcessable(parseIncomingMessage({ item_list: [{ type: MessageItemType.TEXT, text_item: { text: "hi" } }] }))).toBe(true);
  });
  it("有媒体可处理", () => {
    expect(isProcessable(parseIncomingMessage({ item_list: [{ type: MessageItemType.IMAGE, image_item: {} }] }))).toBe(true);
  });
  it("空消息不可处理", () => {
    expect(isProcessable(parseIncomingMessage({}))).toBe(false);
  });
  it("畸形字段安全降级，不抛异常", () => {
    // 协议字段来自外部，可能缺失或类型不符；抛异常会被上层只记日志，导致消息永久丢失
    const malformed: unknown[] = [
      { item_list: "not-an-array" },
      { item_list: { a: 1 } },
      { from_user_id: 12345, session_id: 999, item_list: [] },
    ];
    for (const raw of malformed) {
      const parsed = parseIncomingMessage(raw as never);
      expect(typeof parsed.text).toBe("string");
      expect(typeof parsed.fromUserId).toBe("string");
    }
    // 数组中的合法项仍应被正确提取（其余非法元素被跳过）
    const mixed = parseIncomingMessage({ item_list: [null, { type: MessageItemType.TEXT, text_item: { text: "ok" } }] } as never);
    expect(mixed.text).toBe("ok");
  });
});
