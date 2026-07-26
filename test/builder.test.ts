import { describe, it, expect } from "vitest";
import { buildTextMessage, buildImageMessage, buildFileMessage, generateClientId } from "../src/message/builder.js";
import { MessageItemType, MessageState, MessageType } from "../src/ilink/types.js";
import type { UploadedInfo } from "../src/ilink/media.js";

const uploaded: UploadedInfo = {
  filekey: "fk",
  downloadEncryptedQueryParam: "dl-param",
  aeskeyHex: "00112233445566778899aabbccddeeff",
  fileSize: 100,
  fileSizeCiphertext: 112,
};

describe("buildTextMessage", () => {
  it("构造文本回复", () => {
    const msg = buildTextMessage("回复内容", { to: "user-1", contextToken: "ctx" });
    expect(msg.to_user_id).toBe("user-1");
    expect(msg.from_user_id).toBe("");
    expect(msg.message_type).toBe(MessageType.BOT);
    expect(msg.message_state).toBe(MessageState.FINISH);
    expect(msg.context_token).toBe("ctx");
    expect(msg.item_list?.[0].type).toBe(MessageItemType.TEXT);
    expect(msg.item_list?.[0].text_item?.text).toBe("回复内容");
    expect(msg.client_id).toBeTruthy();
  });
});

describe("buildImageMessage", () => {
  it("构造图片消息", () => {
    const msg = buildImageMessage(uploaded, { to: "u", contextToken: "ctx" });
    const item = msg.item_list?.[0];
    expect(item?.type).toBe(MessageItemType.IMAGE);
    expect(item?.image_item?.media?.encrypt_query_param).toBe("dl-param");
    expect(item?.image_item?.mid_size).toBe(112);
  });
});

describe("buildFileMessage", () => {
  it("构造文件消息", () => {
    const msg = buildFileMessage(uploaded, "report.pdf", { to: "u" });
    const item = msg.item_list?.[0];
    expect(item?.type).toBe(MessageItemType.FILE);
    expect(item?.file_item?.file_name).toBe("report.pdf");
    expect(item?.file_item?.len).toBe("100");
  });
});

describe("generateClientId", () => {
  it("生成唯一 client_id", () => {
    const a = generateClientId();
    const b = generateClientId();
    expect(a).not.toBe(b);
    expect(a.startsWith("pi-weixin-bridge:")).toBe(true);
  });
});
