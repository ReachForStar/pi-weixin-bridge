import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { formatFromBytes, formatFromPath, toMarkdownBytes, toDocument } from "@firecrawl/anydoc";

const [input, output, mode, declaredFormat] = process.argv.slice(2);
if (!input || !output || !["reject", "hosted"].includes(mode)) throw new Error("文档转换参数无效");
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
  await writeFile(output, markdown, { encoding: "utf8", flag: "wx" });
  process.stdout.write(JSON.stringify({ assets }));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = error.code === "needsOcr" ? 3 : 1;
}
