import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { formatFromBytes, formatFromPath } from "@firecrawl/anydoc";
import type { InboundMedia } from "../ilink/media.js";

const run = promisify(execFile);
const CLI_PATH = join(dirname(createRequire(import.meta.url).resolve("@firecrawl/anydoc")), "cli.js");
const CONVERSION_TIMEOUT_MS = 120_000;

export class DocumentConversionError extends Error {
  constructor(public readonly notice: string, cause: unknown) {
    super(`入站文档转换失败: ${String(cause)}`, { cause });
    this.name = "DocumentConversionError";
  }
}

export async function prepareInboundDocuments(
  files: InboundMedia["files"],
  options: { signal?: AbortSignal; onConverting?: () => void } = {},
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
      const { stdout } = await run(process.execPath, [CLI_PATH, input, "--format", format, "--ocr", "reject"], {
        signal: options.signal,
        timeout: CONVERSION_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      });
      options.signal?.throwIfAborted();
      if (!stdout.trim()) throw new Error("anydoc 没有生成可读取内容");
      await writeFile(output, stdout, { encoding: "utf8", flag: "wx" });
      notes.push([
        `附件 ${JSON.stringify(file.name)} 已经 anydoc 本地转换为 Markdown。`,
        `原文件：${JSON.stringify(input)}`,
        `Markdown 文件：${JSON.stringify(output)}`,
        "请先使用 read 工具读取 Markdown 文件，再按用户要求处理；仅有附件而没有具体问题时，概述内容并说明可继续处理的事项。",
      ].join("\n"));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const code = (error as { code?: string | number }).code;
      const notice = code === 3
        ? "⚠️ 此 PDF 包含需要 OCR 的扫描页。原文件已保留，未上传外部服务；云端 OCR 需要先确认上传到 Firecrawl。"
        : "⚠️ 附件转换为 Markdown 失败，原文件已保留。请检查文件是否损坏或加密，详细原因已记录到服务日志。";
      throw new DocumentConversionError(notice, error);
    }
  }
  return notes;
}
