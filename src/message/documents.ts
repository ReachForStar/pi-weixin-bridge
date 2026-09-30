import { execFile } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { formatFromBytes, formatFromPath } from "@firecrawl/anydoc";
import type { InboundMedia } from "../ilink/media.js";

const run = promisify(execFile);
const WORKER = fileURLToPath(new URL("../../scripts/convert-document.mjs", import.meta.url));
const CONVERSION_TIMEOUT_MS = 120_000;

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
      if (!format) continue;
      options.onConverting?.();
      // 独立进程限制原生解析耗时，参数数组避免文件名被 shell 执行；OCR 始终拒绝外传。
      let existing = false;
      try { await access(output); existing = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const { stdout } = existing ? { stdout: JSON.stringify({ assets: [] }) }
        : await run(process.execPath, [WORKER, input, output, options.ocr ?? "reject", format], {
        signal: options.signal,
        timeout: CONVERSION_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      });
      options.signal?.throwIfAborted();
      const converted = JSON.parse(stdout) as { assets: string[] };
      options.onConverted?.(input, converted.assets);
      notes.push([
        `附件 ${JSON.stringify(file.name)} 已经 anydoc 转换为 Markdown（${options.ocr === "hosted" ? "逐文件授权云端 OCR" : "本地转换"}）。`,
        `原文件：${JSON.stringify(input)}`,
        `Markdown 文件：${JSON.stringify(output)}`,
        "请先使用 read 工具读取 Markdown 文件，再按用户要求处理；仅有附件而没有具体问题时，概述内容并说明可继续处理的事项。",
      ].join("\n"));
      if (converted.assets.length) notes.push(`文档内嵌图片已保留：${JSON.stringify(converted.assets)}。需要解释图表时使用 read 工具查看，回答引用原文档名称。`);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const code = (error as { code?: string | number }).code;
      if (code === 3) options.onNeedsOcr?.(input);
      const notice = code === 3
        ? "⚠️ 此 PDF 包含需要 OCR 的扫描页。原文件已保留，未上传外部服务；云端 OCR 需要先确认上传到 Firecrawl。"
        : "⚠️ 附件转换为 Markdown 失败，原文件已保留。请检查文件是否损坏或加密，详细原因已记录到服务日志。";
      throw new DocumentConversionError(notice, error);
    }
  }
  return notes;
}
