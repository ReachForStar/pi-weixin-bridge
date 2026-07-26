import { describe, it, expect } from "vitest";
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
  it("计算 PKCS7 填充后的密文大小", () => {
    expect(aesEcbPaddedSize(0)).toBe(16);
    expect(aesEcbPaddedSize(1)).toBe(16);
    expect(aesEcbPaddedSize(15)).toBe(16);
    expect(aesEcbPaddedSize(16)).toBe(32);
    expect(aesEcbPaddedSize(32)).toBe(48);
  });
});

describe("detectImageMime", () => {
  it("识别 JPEG", () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe("image/jpeg");
  });

  it("识别 PNG", () => {
    expect(detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
  });

  it("识别 GIF", () => {
    expect(detectImageMime(Buffer.from("GIF89a...."))).toBe("image/gif");
    expect(detectImageMime(Buffer.from("GIF87a...."))).toBe("image/gif");
  });

  it("识别 WebP", () => {
    const buf = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);
    expect(detectImageMime(buf)).toBe("image/webp");
  });

  it("未知格式默认 jpeg", () => {
    expect(detectImageMime(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBe("image/jpeg");
  });
});
