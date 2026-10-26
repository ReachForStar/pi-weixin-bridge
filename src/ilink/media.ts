import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
/**
 * 下载阶段的内存硬上限（未传 maxFileBytes 时的兜底）。
 * 这是「服务器自我保护」的绝对上限，不随配置放宽；配置更小时以配置为准。
 */
const DOWNLOAD_HARD_CAP = 64 * 1024 * 1024;

/** 流式读取响应体，超过 maxBytes 立即中止，避免大文件先占满内存再被拒 */
async function readBodyCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const header = res.headers.get("content-length");
  const declared = header === null ? undefined : Number(header);
  // content-length 是密文长度；解密后不超过它，可作为提前拒绝的依据
  if (declared !== undefined && Number.isFinite(declared) && declared > maxBytes) {
    // 未消费的响应体会占住连接，抛出前先取消
    await res.body?.cancel().catch(() => { /* 取消失败不影响抛出 */ });
    throw new MediaTooLargeError(declared, maxBytes);
  }
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new MediaTooLargeError(total, maxBytes);
    chunks.push(Buffer.from(chunk));
  }
  const joined = Buffer.concat(chunks);
  // 声明长度与实际不符说明响应被截断：交给重试，而不是让解密报无从理解的填充错误
  if (declared !== undefined && Number.isFinite(declared) && joined.length !== declared) {
    throw new Error(`CDN 响应被截断（声明 ${declared} 字节，实收 ${joined.length} 字节）`);
  }
  return joined;
}

/** 下载 CDN 字节：超时 + 重试（terminated 等瞬时断连重拉；4xx 不重试——签名/参数错误重试无意义） */
async function fetchCdnBytes(url: string, signal?: AbortSignal, maxBytes = DOWNLOAD_HARD_CAP): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CDN_FETCH_RETRIES; attempt++) {
    try {
      signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(CDN_FETCH_TIMEOUT_MS);
      const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!res.ok) throw new Error(`CDN 下载失败 ${res.status} ${res.statusText}`);
      return await readBodyCapped(res, maxBytes);
    } catch (err) {
      signal?.throwIfAborted();
      lastErr = err;
      // 确定性失败（4xx / 超限）重试无意义
      if (err instanceof MediaTooLargeError) break;
      if (/CDN 下载失败 4\d\d/.test(String(err))) break;
      if (attempt < CDN_FETCH_RETRIES) {
        logger.warn(`[media] CDN 下载第 ${attempt} 次失败（${String(err)}），${500 * attempt}ms 后重试`);
        await delay(500 * attempt, undefined, { signal });
      }
    }
  }
  throw lastErr;
}

async function downloadAndDecrypt(encryptQueryParam: string, aesKeyBase64: string, fullUrl?: string, signal?: AbortSignal, maxBytes?: number): Promise<Buffer> {
  const key = parseAesKey(aesKeyBase64);
  const url = fullUrl || buildCdnDownloadUrl(encryptQueryParam);
  return decryptAesEcb(await fetchCdnBytes(url, signal, maxBytes), key);
}

async function downloadPlain(encryptQueryParam: string, fullUrl?: string, signal?: AbortSignal, maxBytes?: number): Promise<Buffer> {
  const url = fullUrl || buildCdnDownloadUrl(encryptQueryParam);
  return fetchCdnBytes(url, signal, maxBytes);
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
  /** 原件路径与原始文件名，供后续按文件格式处理。 */
  files: Array<{ name: string; path: string }>;
}

/** 解析并下载入站消息中的媒体：图片转 base64 给 pi，文件/视频落盘并返回路径说明 */
export class MediaDownloadError extends Error {
  readonly notice = "⚠️ 附件下载或保存失败，本次任务未提交给模型。请重新发送附件并检查服务日志。";

  constructor(cause: unknown) {
    super(`媒体处理失败: ${String(cause)}`, { cause });
    this.name = "MediaDownloadError";
  }
}

/**
 * 附件超过配置上限。单独的「超大」类型：可透传明确文案给用户，
 * 不能被包成通用的「下载失败」（会把用户引向错误的排查方向）。
 */
export class MediaTooLargeError extends Error {
  readonly notice: string;
  constructor(size: number | undefined, limit: number) {
    super(size === undefined ? `附件超过大小上限 ${limit} 字节` : `附件过大（${size} 字节，上限 ${limit} 字节）`);
    this.name = "MediaTooLargeError";
    this.notice = size === undefined
      ? `⚠️ 附件超过大小上限（${limit} 字节）。请压缩或拆分后重新发送。`
      : `⚠️ 附件过大（${size} 字节，上限 ${limit} 字节）。请压缩或拆分后重新发送。`;
  }
}

export async function downloadInboundMedia(items?: MessageItem[], signal?: AbortSignal, workspace = WORKSPACE, maxFileBytes = DOWNLOAD_HARD_CAP): Promise<InboundMedia> {
  signal?.throwIfAborted();
  const result: InboundMedia = { images: [], notes: [], files: [] };
  if (!items?.length) return result;
  const mediaDir = join(workspace, "media", "inbound");
  // 加密开销按 AES 分块上浮，留出余量；解密后大小仍以调用侧 maxFileBytes 为准
  const downloadCap = Math.max(maxFileBytes, 1) + 16;

  for (const item of items) {
    try {
      signal?.throwIfAborted();
      if (item.type === MessageItemType.IMAGE) {
        const img = item.image_item;
        if (!img?.media?.encrypt_query_param && !img?.media?.full_url) throw new Error("图片缺少下载地址");
        // 入站图片优先用 image_item.aeskey（hex），其次 media.aes_key
        const aesKeyB64 = img.aeskey
          ? Buffer.from(img.aeskey, "hex").toString("base64")
          : img.media?.aes_key;
        const buf = aesKeyB64
          ? await downloadAndDecrypt(img.media?.encrypt_query_param ?? "", aesKeyB64, img.media?.full_url, signal, downloadCap)
          : await downloadPlain(img.media?.encrypt_query_param ?? "", img.media?.full_url, signal, downloadCap);
        // 图片此前完全没有走上限校验；base64 还会额外膨胀约 1.33 倍，必须同样拦截
        if (buf.length > maxFileBytes) throw new MediaTooLargeError(buf.length, maxFileBytes);
        result.images.push({ mimeType: detectImageMime(buf), data: buf.toString("base64") });
      } else if (item.type === MessageItemType.VOICE) {
        // 有语音转文字时由 extractText 提取为正文，这里仅在无文字时补充说明
        if (!item.voice_item?.text) result.notes.push("[收到一条语音消息（无文字内容）]");
      } else if (item.type === MessageItemType.FILE) {
        const f = item.file_item;
        if ((!f?.media?.encrypt_query_param && !f?.media?.full_url) || !f?.media?.aes_key) throw new Error("文件缺少下载地址或解密密钥");
        const buf = await downloadAndDecrypt(f.media.encrypt_query_param ?? "", f.media.aes_key, f.media.full_url, signal, downloadCap);
        signal?.throwIfAborted();
        // 超限文件在落盘前就拒绝，不能先写盘再由调用方删除
        if (buf.length > maxFileBytes) throw new Error("附件超过配置大小上限");
        await mkdir(mediaDir, { recursive: true });
        const name = f.file_name || `file-${Date.now()}`;
        // 微信文件名不参与目录选择，随机前缀避免并发附件互相覆盖。
        const safeName = basename(name.replace(/\\/g, "/")).replace(/[\x00-\x1f<>:"/\\|?*]/g, "_")
          .replace(/[. ]+$/, "").slice(0, 180) || "file";
        const path = join(mediaDir, `${randomUUID()}-${safeName}`);
        await writeFile(path, buf, { flag: "wx" });
        result.files.push({ name, path });
        result.notes.push(`[收到文件 ${name}，已保存到 ${path}]`);
      } else if (item.type === MessageItemType.VIDEO) {
        const v = item.video_item;
        if ((!v?.media?.encrypt_query_param && !v?.media?.full_url) || !v?.media?.aes_key) throw new Error("视频缺少下载地址或解密密钥");
        const buf = await downloadAndDecrypt(v.media.encrypt_query_param ?? "", v.media.aes_key, v.media.full_url, signal, downloadCap);
        signal?.throwIfAborted();
        if (buf.length > maxFileBytes) throw new Error("附件超过配置大小上限");
        await mkdir(mediaDir, { recursive: true });
        const path = join(mediaDir, `video-${randomUUID()}.mp4`);
        await writeFile(path, buf, { flag: "wx" });
        result.notes.push(`[收到视频，已保存到 ${path}]`);
      }
    } catch (err) {
      signal?.throwIfAborted();
      // 超限是用户可理解的原因，直接透传，不包成通用的「下载失败」
      if (err instanceof MediaTooLargeError) throw err;
      throw new MediaDownloadError(err);
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
  signal?: AbortSignal;
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
    signal: params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(CDN_FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(CDN_FETCH_TIMEOUT_MS),
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
  signal?: AbortSignal,
): Promise<UploadedInfo> {
  signal?.throwIfAborted();
  const plaintext = await readFile(filePath);
  signal?.throwIfAborted();
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
  }, signal);
  if (!resp.upload_full_url && !resp.upload_param) {
    throw new Error("getUploadUrl 未返回上传 URL");
  }
  const downloadParam = await uploadBufferToCdn({
    buf: plaintext,
    uploadFullUrl: resp.upload_full_url,
    uploadParam: resp.upload_param,
    filekey,
    aeskey,
    signal,
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
export async function uploadImage(client: IlinkClient, filePath: string, toUserId: string, signal?: AbortSignal): Promise<UploadedInfo> {
  return uploadMedia(client, filePath, toUserId, UploadMediaType.IMAGE, signal);
}

/** 上传本地文件（uploadMedia 的 FILE 包装） */
export async function uploadFile(client: IlinkClient, filePath: string, toUserId: string, signal?: AbortSignal): Promise<UploadedInfo> {
  return uploadMedia(client, filePath, toUserId, UploadMediaType.FILE, signal);
}

/** 上传本地视频（uploadMedia 的 VIDEO 包装） */
export async function uploadVideo(client: IlinkClient, filePath: string, toUserId: string): Promise<UploadedInfo> {
  return uploadMedia(client, filePath, toUserId, UploadMediaType.VIDEO);
}
