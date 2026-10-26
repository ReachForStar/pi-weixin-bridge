import { execFile } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { formatFromBytes, formatFromPath } from "@firecrawl/anydoc";
import type { InboundMedia } from "../ilink/media.js";

const run = promisify(execFile);
const WORKER = fileURLToPath(new URL("../../scripts/convert-document.mjs", import.meta.url));
const CONVERSION_TIMEOUT_MS = 120_000;

/** 转换产物元数据（由工作进程写 sidecar）；用于判定已有 .md 是否可复用 */
interface ConversionMeta {
  inputSha256: string;
  inputSize: number;
  outputSize: number;
  outputSha256: string;
  assets: string[];
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * 校验已有产物是否完整且对应当前输入。
 * 仅凭「.md 文件存在」就复用会让超时/停止留下的截断产物被永久当成转换成功，
 * 因此必须核对 sidecar 的输入指纹与输出大小/哈希。
 */
async function reusableOutput(input: string, output: string, inputBytes: Buffer): Promise<ConversionMeta | undefined> {
  try {
    const meta = JSON.parse(await readFile(`${output}.meta.json`, "utf8")) as ConversionMeta;
    // 输入已变化（同名不同内容）时不能复用
    if (meta.inputSha256 !== sha256(inputBytes) || meta.inputSize !== inputBytes.length) return undefined;
    const actual = await stat(output);
    if (actual.size !== meta.outputSize || actual.size === 0) return undefined;
    if (sha256(await readFile(output)) !== meta.outputSha256) return undefined;
    return meta;
  } catch {
    // 无 sidecar / 产物缺失 / 内容不符：一律重新转换
    return undefined;
  }
}

export class DocumentConversionError extends Error {
  constructor(public readonly notice: string, cause: unknown) {
    super(`入站文档转换失败: ${String(cause)}`, { cause });
    this.name = "DocumentConversionError";
  }
}

export async function prepareInboundDocuments(
  files: InboundMedia["files"],
  options: { signal?: AbortSignal; onConverting?: () => void; ocr?: "reject" | "hosted";
    onConverted?: (path: string, assets: string[]) => void; onNeedsOcr?: (path: string) => void } = {},
): Promise<string[]> {
  const notes: string[] = [];
  for (const file of files) {
    options.signal?.throwIfAborted();
    const input = resolve(file.path);
    const output = `${input}.md`;
    try {
      // 格式识别交给 anydoc，文件内容优先，CSV 等无签名格式才按扩展名识别。
      const format = formatFromBytes(await readFile(input)) ?? formatFromPath(file.name);
      if (!format) {
        // 本身已是 Markdown/纯文本时无需转换，直接交给模型（保持原有静默行为）。
        if (/\.(md|markdown|txt)$/i.test(file.name)) continue;
        // 其余无法识别的二进制（如 zip）：必须明确告知，否则模型可能去读原始二进制，
        // 用户也无从知道「附件其实没被解析」。
        notes.push(`附件 ${JSON.stringify(file.name)} 的格式无法识别，未转换为 Markdown；如需处理请告知我如何解读该文件。`);
        continue;
      }
      options.onConverting?.();
      const inputBytes = await readFile(input);
      // 只复用校验通过的产物；截断或输入已变的残留先清掉，避免被反复误判
      let reusable = await reusableOutput(input, output, inputBytes);
      let assets: string[];
      if (reusable) {
        assets = reusable.assets ?? [];
      } else {
        for (const stale of [output, `${output}.meta.json`]) {
          try { await unlink(stale); } catch { /* 不存在即可 */ }
        }
        // 转换期间被中断时可能只留下 .tmp，一并清理
        const { stdout } = await run(process.execPath, [WORKER, input, output, options.ocr ?? "reject", format], {
          signal: options.signal,
          timeout: CONVERSION_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
        });
        options.signal?.throwIfAborted();
        assets = (JSON.parse(stdout) as { assets: string[] }).assets;
        // 工作进程写完后复核一次：确认产物真的完整，而不是"文件碰巧存在"
        reusable = await reusableOutput(input, output, inputBytes);
        if (!reusable) throw new Error("转换产物校验未通过（文件不完整）");
      }
      options.onConverted?.(input, assets);
      notes.push([
        `附件 ${JSON.stringify(file.name)} 已经 anydoc 转换为 Markdown（${options.ocr === "hosted" ? "逐文件授权云端 OCR" : "本地转换"}）。`,
        `原文件：${JSON.stringify(input)}`,
        `Markdown 文件：${JSON.stringify(output)}`,
        "请先使用 read 工具读取 Markdown 文件，再按用户要求处理；仅有附件而没有具体问题时，概述内容并说明可继续处理的事项。",
      ].join("\n"));
      if (assets.length) notes.push(`文档内嵌图片已保留：${JSON.stringify(assets)}。需要解释图表时使用 read 工具查看，回答引用原文档名称。`);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const code = (error as { code?: string | number }).code;
      if (code === 3) options.onNeedsOcr?.(input);
      // 区分三类失败：需要 OCR / 转换超时（含被 stop 杀掉）/ 文件本身损坏或加密
      const timedOut = code === "ETIMEDOUT" || (error as { killed?: boolean }).killed === true;
      let notice: string;
      if (code === 3) {
        notice = "⚠️ 此 PDF 包含需要 OCR 的扫描页。原文件已保留，未上传外部服务；云端 OCR 需要先确认上传到 Firecrawl。";
      } else if (timedOut) {
        notice = `⚠️ 附件转换超时（超过 ${Math.round(CONVERSION_TIMEOUT_MS / 1000)} 秒）或被中止，已放弃本次转换。原文件已保留，可稍后重新发送该文件。`;
      } else {
        notice = "⚠️ 附件转换为 Markdown 失败，原文件已保留。请检查文件是否损坏或加密，详细原因已记录到服务日志。";
      }
      throw new DocumentConversionError(notice, error);
    }
  }
  return notes;
}
