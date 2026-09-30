import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
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
  let server: Server | undefined;

  beforeEach(() => {
    mkdirSync("tmp", { recursive: true });
    const ws = mkdtempSync(join("tmp", "piwx-media-"));
    vi.stubEnv("PI_WEIXIN_WORKSPACE", ws);
    vi.stubEnv("PI_WEIXIN_STATE_DIR", join(ws, "state"));
    vi.stubEnv("USERPROFILE", ws);
    vi.stubEnv("HOME", ws);
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
      server = undefined;
    }
  });

  function fileItem(url: string) {
    return {
      type: 4, // MessageItemType.FILE
      file_item: {
        file_name: "LICENSE",
        media: {
          full_url: url,
          aes_key: key.toString("base64"),
        },
      },
    };
  }

  async function listen(): Promise<string> {
    server!.listen(0, "127.0.0.1");
    await once(server!, "listening");
    const address = server!.address();
    if (!address || typeof address === "string") throw new Error("无法获取下载测试地址");
    return `http://127.0.0.1:${address.port}`;
  }

  it("真实连接第一次断开、第二次成功，文件落盘", async () => {
    const plaintext = readFileSync("LICENSE");
    const cipher = encryptAesEcb(plaintext, key);
    let requests = 0;
    server = createServer((request, response) => {
      if (++requests === 1) request.socket.destroy();
      else response.end(cipher);
    });
    const url = await listen();

    const { downloadInboundMedia } = await import("../src/ilink/media.js");
    const res = await downloadInboundMedia([fileItem(url)]);
    expect(requests).toBe(2);
    expect(res.notes.length).toBe(1);
    expect(res.notes[0]).toContain("LICENSE");
    expect(res.notes[0]).toContain("已保存到");
    const path = res.notes[0].match(/已保存到 (.+?)\]$/)![1];
    expect(readFileSync(path)).toEqual(plaintext);
  });

  it("4xx 不重试（签名/参数错误）", async () => {
    let requests = 0;
    server = createServer((_request, response) => {
      requests++;
      response.writeHead(403);
      response.end();
    });
    const url = await listen();

    const { downloadInboundMedia } = await import("../src/ilink/media.js");
    await expect(downloadInboundMedia([fileItem(url)])).rejects.toMatchObject({ name: "MediaDownloadError" });
    expect(requests).toBe(1);
  });

  it("三次全失败 → 报失败（不无限重试）", async () => {
    let requests = 0;
    server = createServer((request) => {
      requests++;
      request.socket.destroy();
    });
    const url = await listen();

    const { downloadInboundMedia } = await import("../src/ilink/media.js");
    await expect(downloadInboundMedia([fileItem(url)])).rejects.toMatchObject({ name: "MediaDownloadError" });
    expect(requests).toBe(3);
  });

  it("停止正在读取的真实 HTTP 响应，不重试", async () => {
    const controller = new AbortController();
    let requests = 0;
    server = createServer((_request, response) => {
      requests++;
      response.writeHead(200);
      response.flushHeaders();
      controller.abort();
    });
    const url = await listen();
    const { downloadInboundMedia } = await import("../src/ilink/media.js");
    await expect(downloadInboundMedia([fileItem(url)], controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toBe(1);
  });

  it("缺失附件地址时明确失败", async () => {
    const { downloadInboundMedia } = await import("../src/ilink/media.js");
    await expect(downloadInboundMedia([{ type: 4, file_item: { file_name: "LICENSE" } }]))
      .rejects.toMatchObject({ name: "MediaDownloadError" });
  });
});
