import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encryptAesEcb,
  decryptAesEcb,
  aesEcbPaddedSize,
  detectImageMime,
} from "../src/ilink/media.js";

describe("AES-128-ECB 加解密", () => {
  const key = Buffer.from("0123456789abcdef"); // 16 字节

  it("加解密往返一致", () => {
    const plaintext = Buffer.from("hello weixin bridge 测试中文");
    const cipher = encryptAesEcb(plaintext, key);
    expect(cipher.equals(plaintext)).toBe(false);
    expect(decryptAesEcb(cipher, key).toString()).toBe(plaintext.toString());
  });

  it("密文按 16 字节对齐（PKCS7）", () => {
    expect(encryptAesEcb(Buffer.from("abc"), key).length % 16).toBe(0);
    expect(encryptAesEcb(Buffer.from("0123456789abcdef"), key).length % 16).toBe(0);
  });

  it("空内容加解密", () => {
    const cipher = encryptAesEcb(Buffer.alloc(0), key);
    expect(decryptAesEcb(cipher, key).length).toBe(0);
  });
});

describe("aesEcbPaddedSize", () => {
  it("对齐到 16 字节倍数", () => {
    expect(aesEcbPaddedSize(0)).toBe(16);
    expect(aesEcbPaddedSize(1)).toBe(16);
    expect(aesEcbPaddedSize(16)).toBe(32);
    expect(aesEcbPaddedSize(17)).toBe(32);
  });
});

describe("detectImageMime", () => {
  it("jpeg / png / gif / webp 魔数", () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(detectImageMime(Buffer.from("GIF89a", "ascii"))).toBe("image/gif");
    expect(detectImageMime(Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]))).toBe("image/webp");
  });

  it("未知格式默认 jpeg", () => {
    expect(detectImageMime(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBe("image/jpeg");
  });
});

// CDN 下载重试：瞬时断连（terminated）自动重拉；4xx 不重试
describe("downloadInboundMedia 文件下载重试", () => {
  const key = Buffer.from("0123456789abcdef");

  beforeEach(() => {
    const ws = mkdtempSync(join(tmpdir(), "piwx-media-"));
    vi.stubEnv("PI_WEIXIN_WORKSPACE", ws);
    vi.stubEnv("PI_WEIXIN_STATE_DIR", join(ws, "state"));
    vi.stubEnv("USERPROFILE", ws);
    vi.stubEnv("HOME", ws);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function fileItem(plaintext: Buffer) {
    return {
      type: 4, // MessageItemType.FILE
      file_item: {
        file_name: "test.pdf",
        media: {
          encrypt_query_param: "enc-param",
          aes_key: key.toString("base64"),
        },
      },
    };
  }

  it("第一次 terminated、第二次成功 → 文件落盘（重试生效）", async () => {
    const plaintext = Buffer.from("fake pdf content 123");
    const cipher = encryptAesEcb(plaintext, key);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("terminated"))
      .mockResolvedValueOnce(new Response(cipher, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { downloadInboundMedia } = await import("../src/ilink/media.js");
    const res = await downloadInboundMedia([fileItem(plaintext)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.notes.length).toBe(1);
    expect(res.notes[0]).toContain("test.pdf");
    expect(res.notes[0]).toContain("已保存到");
    const path = res.notes[0].match(/已保存到 (.+?)\]$/)![1];
    expect(readFileSync(path).toString()).toBe("fake pdf content 123");
  });

  it("4xx 不重试（签名/参数错误）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("bad", { status: 403, statusText: "Forbidden" }));
    vi.stubGlobal("fetch", fetchMock);

    const { downloadInboundMedia } = await import("../src/ilink/media.js");
    const res = await downloadInboundMedia([fileItem(Buffer.from("x"))]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.notes[0]).toContain("媒体处理失败");
  });

  it("三次全失败 → 报失败（不无限重试）", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("terminated"));
    vi.stubGlobal("fetch", fetchMock);

    const { downloadInboundMedia } = await import("../src/ilink/media.js");
    const res = await downloadInboundMedia([fileItem(Buffer.from("x"))]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.notes[0]).toContain("媒体处理失败");
  });
});
