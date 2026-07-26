import { describe, it, expect, vi, afterEach } from "vitest";
import { IlinkClient } from "../src/ilink/client.js";
import { MessageItemType, MessageType, MessageState } from "../src/ilink/types.js";

/** 构造一个返回指定 JSON 的 fetch mock */
function mockFetch(responseBody: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => JSON.stringify(responseBody),
    headers: new Headers(),
  });
}

describe("IlinkClient 请求构造", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sendMessage：正确地址 + 鉴权头 + 消息体", async () => {
    const fetchMock = mockFetch({ ret: 0 });
    vi.stubGlobal("fetch", fetchMock);
    const client = new IlinkClient("https://ilinkai.weixin.qq.com", "test-token");

    await client.sendMessage({
      from_user_id: "",
      to_user_id: "user-123",
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: [{ type: MessageItemType.TEXT, text_item: { text: "回复内容" } }],
      context_token: "ctx-token",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ilinkai.weixin.qq.com/ilink/bot/sendmessage");
    expect(options.method).toBe("POST");
    // 鉴权与协议头
    expect(options.headers.Authorization).toBe("Bearer test-token");
    expect(options.headers.AuthorizationType).toBe("ilink_bot_token");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["iLink-App-Id"]).toBe("bot");
    expect(options.headers["X-WECHAT-UIN"]).toBeTruthy();
    // 消息体含 msg 与 base_info，且 context_token 原样带回
    const body = JSON.parse(options.body);
    expect(body.msg.to_user_id).toBe("user-123");
    expect(body.msg.context_token).toBe("ctx-token");
    expect(body.base_info).toBeDefined();
  });

  it("getUpdates：携带 get_updates_buf 并返回新 buf", async () => {
    const fetchMock = mockFetch({ ret: 0, msgs: [], get_updates_buf: "new-buf" });
    vi.stubGlobal("fetch", fetchMock);
    const client = new IlinkClient("https://ilinkai.weixin.qq.com", "test-token");

    const resp = await client.getUpdates("old-buf", 1000);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ilinkai.weixin.qq.com/ilink/bot/getupdates");
    expect(JSON.parse(options.body).get_updates_buf).toBe("old-buf");
    expect(resp.get_updates_buf).toBe("new-buf");
  });

  it("getUploadUrl：透传请求字段并附加 base_info", async () => {
    const fetchMock = mockFetch({ ret: 0, upload_param: "up" });
    vi.stubGlobal("fetch", fetchMock);
    const client = new IlinkClient("https://ilinkai.weixin.qq.com", "test-token");

    await client.getUploadUrl({ filekey: "fk", media_type: 1, rawsize: 100 });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ilinkai.weixin.qq.com/ilink/bot/getuploadurl");
    const body = JSON.parse(options.body);
    expect(body.filekey).toBe("fk");
    expect(body.media_type).toBe(1);
    expect(body.base_info).toBeDefined();
  });

  it("sendMessage：ret 非 0 抛错", async () => {
    const fetchMock = mockFetch({ ret: -1, errmsg: "send failed" });
    vi.stubGlobal("fetch", fetchMock);
    const client = new IlinkClient("https://ilinkai.weixin.qq.com", "test-token");

    await expect(client.sendMessage({ to_user_id: "u" })).rejects.toThrow("sendMessage ret=-1");
  });

  it("HTTP 非 2xx 抛错", async () => {
    const fetchMock = mockFetch({ error: "server error" }, false, 500);
    vi.stubGlobal("fetch", fetchMock);
    const client = new IlinkClient("https://ilinkai.weixin.qq.com", "test-token");

    await expect(client.getUploadUrl({ filekey: "k" })).rejects.toThrow(/HTTP 500/);
  });

  it("无 token 时不带 Authorization 头", async () => {
    const fetchMock = mockFetch({ ret: 0 });
    vi.stubGlobal("fetch", fetchMock);
    const client = new IlinkClient("https://ilinkai.weixin.qq.com");

    await client.sendMessage({ to_user_id: "u" });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });
});
