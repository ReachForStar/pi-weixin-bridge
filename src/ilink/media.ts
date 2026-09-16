import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG, WORKSPACE } from "../config.js";
import { logger } from "../logger/index.js";
import type { IlinkClient } from "./client.js";
import { MessageItemType, UploadMediaType, type MessageItem } from "./types.js";

// ---- AES-128-ECB ----

export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** AES-128-ECB PKCS7 填充后的密文大小 */
export function aesEcbPaddedSize(size: number): number {
  return Math.ceil((size + 1) / 16) * 16;
}

/**
 * 解析 aes_key：base64 解码后可能是 16 原始字节（图片），
 * 也可能是 32 位 hex 字符串（文件/语音/视频，需再按 hex 解析）。
 */
function parseAesKey(aesKeyBase64: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(`aes_key 非法：解码后 ${decoded.length} 字节`);
}

// ---- CDN URL ----

function buildCdnDownloadUrl(encryptedQueryParam: string): string {
  return `${CONFIG.cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

function buildCdnUploadUrl(uploadParam: string, filekey: string): string {
  return `${CONFIG.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
}

const CDN_FETCH_TIMEOUT_MS = 120_000; // 大文件给足时间
const CDN_FETCH_RETRIES = 3;

/** 下载 CDN 字节：超时 + 重试（terminated 等瞬时断连重拉；4xx 不重试——签名/参数错误重试无意义） */
async function fetchCdnBytes(url: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CDN_FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(CDN_FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`CDN 下载失败 ${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (/CDN 下载失败 4\d\d/.test(String(err))) break;
      if (attempt < CDN_FETCH_RETRIES) {
        logger.warn(`[media] CDN 下载第 ${attempt} 次失败（${String(err)}），${500 * attempt}ms 后重试`);
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw lastErr;
}

async function downloadAndDecrypt(encryptQueryParam: string, aesKeyBase64: string, fullUrl?: string): Promise<Buffer> {
  const key = parseAesKey(aesKeyBase64);
  const url = fullUrl || buildCdnDownloadUrl(encryptQueryParam);
  return decryptAesEcb(await fetchCdnBytes(url), key);
}

async function downloadPlain(encryptQueryParam: string, fullUrl?: string): Promise<Buffer> {
  const url = fullUrl || buildCdnDownloadUrl(encryptQueryParam);
  return fetchCdnBytes(url);
}

/** 按文件头魔数判断图片 MIME */
export function detectImageMime(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 6 && (buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a"))
    return "image/gif";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  return "image/jpeg";
}

// ---- 入站媒体 ----

export interface InboundMedia {
  /** 图片（base64），供 pi 视觉理解 */
  images: Array<{ mimeType: string; data: string }>;
  /** 文件/视频/语音的文本说明 */
  notes: string[];
}

/** 解析并下载入站消息中的媒体：图片转 base64 给 pi，文件/视频落盘并返回路径说明 */
export async function downloadInboundMedia(items?: MessageItem[]): Promise<InboundMedia> {
  const result: InboundMedia = { images: [], notes: [] };
  if (!items?.length) return result;
  const mediaDir = join(WORKSPACE, "media", "inbound");

  for (const item of items) {
    try {
      if (item.type === MessageItemType.IMAGE) {
        const img = item.image_item;
        if (!img?.media?.encrypt_query_param && !img?.media?.full_url) continue;
        // 入站图片优先用 image_item.aeskey（hex），其次 media.aes_key
        const aesKeyB64 = img.aeskey
          ? Buffer.from(img.aeskey, "hex").toString("base64")
          : img.media?.aes_key;
        const buf = aesKeyB64
          ? await downloadAndDecrypt(img.media?.encrypt_query_param ?? "", aesKeyB64, img.media?.full_url)
          : await downloadPlain(img.media?.encrypt_query_param ?? "", img.media?.full_url);
        result.images.push({ mimeType: detectImageMime(buf), data: buf.toString("base64") });
      } else if (item.type === MessageItemType.VOICE) {
        // 有语音转文字时由 extractText 提取为正文，这里仅在无文字时补充说明
        if (!item.voice_item?.text) result.notes.push("[收到一条语音消息（无文字内容）]");
      } else if (item.type === MessageItemType.FILE) {
        const f = item.file_item;
        if ((!f?.media?.encrypt_query_param && !f?.media?.full_url) || !f?.media?.aes_key) continue;
        const buf = await downloadAndDecrypt(f.media.encrypt_query_param ?? "", f.media.aes_key, f.media.full_url);
        await mkdir(mediaDir, { recursive: true });
        const name = f.file_name || `file-${Date.now()}`;
        const path = join(mediaDir, `${Date.now()}-${name}`);
        await writeFile(path, buf);
        result.notes.push(`[收到文件 ${name}，已保存到 ${path}]`);
      } else if (item.type === MessageItemType.VIDEO) {
        const v = item.video_item;
        if ((!v?.media?.encrypt_query_param && !v?.media?.full_url) || !v?.media?.aes_key) continue;
        const buf = await downloadAndDecrypt(v.media.encrypt_query_param ?? "", v.media.aes_key, v.media.full_url);
        await mkdir(mediaDir, { recursive: true });
        const path = join(mediaDir, `video-${Date.now()}.mp4`);
        await writeFile(path, buf);
        result.notes.push(`[收到视频，已保存到 ${path}]`);
      }
    } catch (err) {
      result.notes.push(`[媒体处理失败: ${String(err)}]`);
    }
  }
  return result;
}

// ---- 出站媒体（图片上传） ----

export interface UploadedInfo {
  filekey: string;
  downloadEncryptedQueryParam: string;
  aeskeyHex: string;
  fileSize: number;
  fileSizeCiphertext: number;
}

async function uploadBufferToCdn(params: {
  buf: Buffer;
  uploadFullUrl?: string;
  uploadParam?: string;
  filekey: string;
  aeskey: Buffer;
}): Promise<string> {
  const ciphertext = encryptAesEcb(params.buf, params.aeskey);
  const cdnUrl =
    params.uploadFullUrl?.trim() ||
    (params.uploadParam ? buildCdnUploadUrl(params.uploadParam, params.filekey) : "");
  if (!cdnUrl) throw new Error("缺少 CDN 上传 URL");
  const res = await fetch(cdnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(ciphertext),
  });
  if (res.status !== 200) throw new Error(`CDN 上传失败 ${res.status}`);
  const downloadParam = res.headers.get("x-encrypted-param");
  if (!downloadParam) throw new Error("CDN 上传响应缺少 x-encrypted-param");
  return downloadParam;
}

/** 通用媒体上传：上传本地文件到微信 CDN，返回构造发送消息所需信息。
 *  mediaType 取自 UploadMediaType（IMAGE/VIDEO/FILE/VOICE）。 */
export async function uploadMedia(
  client: IlinkClient,
  filePath: string,
  toUserId: string,
  mediaType: (typeof UploadMediaType)[keyof typeof UploadMediaType],
): Promise<UploadedInfo> {
  const plaintext = await readFile(filePath);
  const rawsize = plaintext.length;
  const rawfilemd5 = createHash("md5").update(plaintext).digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = randomBytes(16).toString("hex");
  const aeskey = randomBytes(16);

  const resp = await client.getUploadUrl({
    filekey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString("hex"),
  });
  if (!resp.upload_full_url && !resp.upload_param) {
    throw new Error("getUploadUrl 未返回上传 URL");
  }
  const downloadParam = await uploadBufferToCdn({
    buf: plaintext,
    uploadFullUrl: resp.upload_full_url,
    uploadParam: resp.upload_param,
    filekey,
    aeskey,
  });
  return {
    filekey,
    downloadEncryptedQueryParam: downloadParam,
    aeskeyHex: aeskey.toString("hex"),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  };
}

/** 上传本地图片（uploadMedia 的 IMAGE 包装） */
export async function uploadImage(client: IlinkClient, filePath: string, toUserId: string): Promise<UploadedInfo> {
  return uploadMedia(client, filePath, toUserId, UploadMediaType.IMAGE);
}

/** 上传本地文件（uploadMedia 的 FILE 包装） */
export async function uploadFile(client: IlinkClient, filePath: string, toUserId: string): Promise<UploadedInfo> {
  return uploadMedia(client, filePath, toUserId, UploadMediaType.FILE);
}

/** 上传本地视频（uploadMedia 的 VIDEO 包装） */
export async function uploadVideo(client: IlinkClient, filePath: string, toUserId: string): Promise<UploadedInfo> {
  return uploadMedia(client, filePath, toUserId, UploadMediaType.VIDEO);
}
