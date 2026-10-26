import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prepareInboundDocuments, DocumentConversionError } from "../src/message/documents.js";
import { encryptAesEcb } from "../src/ilink/media.js";

let server: Server | undefined;

async function directory(): Promise<string> {
  await mkdir("tmp", { recursive: true });
  return resolve(await mkdtemp(join("tmp", "document-test-")));
}

afterEach(async () => {
  vi.unstubAllEnvs();
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
});

describe("anydoc 真实文档处理", () => {
  it("PDF 转 Markdown，保留原件并提示 pi 读取", async () => {
    const root = await directory();
    const file = join(root, "project-license.pdf");
    await copyFile("test/fixtures/project-license.pdf", file);
    const before = await readFile(file);
    const notes = await prepareInboundDocuments([{ name: "project-license.pdf", path: file }]);
    expect(await readFile(`${file}.md`, "utf8")).toContain("MIT License");
    expect(await readFile(file)).toEqual(before);
    expect(notes.join("\n")).toContain("请先使用 read 工具读取 Markdown 文件");
  });

  it("Word 转 Markdown，文件内容可识别无文档扩展名的 PDF", async () => {
    const root = await directory();
    const docx = join(root, "project-license.docx");
    const pdf = join(root, "document.bin");
    await copyFile("test/fixtures/project-license.docx", docx);
    await copyFile("test/fixtures/project-license.pdf", pdf);
    const notes = await prepareInboundDocuments([
      { name: "project-license.docx", path: docx }, { name: "document.bin", path: pdf },
    ]);
    expect(notes).toHaveLength(2);
    expect(await readFile(`${docx}.md`, "utf8")).toContain("MIT License");
    expect(await readFile(`${pdf}.md`, "utf8")).toContain("MIT License");
  });

  it("已有 Markdown 直接交给 pi，不重复转换", async () => {
    const notes = await prepareInboundDocuments([{ name: "README.md", path: resolve("README.md") }]);
    expect(notes).toEqual([]);
  });

  it("损坏 PDF 明确失败，保留原文件，不伪造转换结果", async () => {
    const root = await directory();
    const file = join(root, "damaged.pdf");
    const damaged = (await readFile("test/fixtures/project-license.pdf")).subarray(0, 20);
    await writeFile(file, damaged);
    await expect(prepareInboundDocuments([{ name: "damaged.pdf", path: file }]))
      .rejects.toBeInstanceOf(DocumentConversionError);
    expect(await readFile(file)).toEqual(damaged);
    await expect(readFile(`${file}.md`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("已取消的转换不启动处理", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(prepareInboundDocuments([
      { name: "project-license.pdf", path: "test/fixtures/project-license.pdf" },
    ], { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("真实加密附件下载后自动转换，文件名不能逃出保存目录", async () => {
    const root = await directory();
    vi.stubEnv("PI_WEIXIN_WORKSPACE", root);
    vi.resetModules();
    const key = randomBytes(16);
    const bytes = await readFile("test/fixtures/project-license.pdf");
    const encrypted = encryptAesEcb(bytes, key);
    server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end(encrypted);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("无法获取附件测试地址");
    const { downloadInboundMedia } = await import("../src/ilink/media.js");
    const media = await downloadInboundMedia([{ type: 4, file_item: {
      file_name: "../../folder\\project-license.pdf",
      media: { full_url: `http://127.0.0.1:${address.port}`, aes_key: key.toString("base64") },
    } }]);
    expect(media.files).toHaveLength(1);
    expect(media.files[0].path.startsWith(join(root, "media", "inbound"))).toBe(true);
    const notes = await prepareInboundDocuments(media.files);
    expect(notes).toHaveLength(1);
    expect(await readFile(`${media.files[0].path}.md`, "utf8")).toContain("MIT License");
    expect(await readFile(media.files[0].path)).toEqual(bytes);
  });
});
