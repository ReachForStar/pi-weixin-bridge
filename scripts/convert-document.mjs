// 文档转换工作进程：独立进程限制原生解析耗时，产物原子落盘并写 sidecar 元数据。
// 元数据用于父进程校验产物完整性（输入指纹 + 输出大小/哈希），避免复用被中断的截断产物。
import { readFile, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { formatFromBytes, formatFromPath, toMarkdownBytes, toDocument } from "@firecrawl/anydoc";

const [input, output, mode, declaredFormat] = process.argv.slice(2);
if (!input || !output || !["reject", "hosted"].includes(mode)) throw new Error("文档转换参数无效");

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** 原子写：先写唯一临时文件再改名，进程中途被杀不会留下半截目标文件 */
async function writeAtomic(path, data, encoding) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { encoding, flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    try { await unlink(temporary); } catch { /* 清理失败不掩盖原始错误 */ }
    throw error;
  }
}

try {
  const bytes = await readFile(input);
  const format = formatFromBytes(bytes) ?? formatFromPath(input) ?? declaredFormat;
  const markdown = await toMarkdownBytes(bytes, format, { ocr: mode });
  if (!markdown.trim()) throw new Error("anydoc 未生成可读取内容");
  const assets = [];
  const assetsDir = `${output}.assets/${randomUUID()}`;
  if (format && format !== "pdf") {
    const document = await toDocument(bytes, format);
    const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
    for (const asset of document.assets) {
      const extension = extensions[asset.mediaType];
      if (!extension) continue;
      await mkdir(assetsDir, { recursive: true });
      const path = `${assetsDir}/${asset.id}.${extension}`;
      await writeFile(path, asset.data, { flag: "wx" });
      assets.push(path);
    }
  }
  const encoded = Buffer.from(markdown, "utf8");
  await writeAtomic(output, encoded, undefined);
  // sidecar 最后写：它的存在即代表产物已完整落盘
  const meta = {
    inputSha256: sha256(bytes),
    inputSize: bytes.length,
    outputSize: encoded.length,
    outputSha256: sha256(encoded),
    assets,
    format,
    createdAt: Date.now(),
  };
  await writeAtomic(`${output}.meta.json`, JSON.stringify(meta), "utf8");
  process.stdout.write(JSON.stringify({ assets }));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = error.code === "needsOcr" ? 3 : 1;
}
