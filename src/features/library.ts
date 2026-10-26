import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { logger } from "../logger/index.js";
import { basename, dirname, join } from "node:path";
import MiniSearch from "minisearch";
import { STATE_DIR } from "../config.js";
import { ScopedState, scopeId } from "./state.js";

/** 单文件索引上限与单次检索总预算（防止一次 /files find 读入过多内容） */
const SEARCH_MAX_BYTES_PER_FILE = 2 * 1024 * 1024;
const SEARCH_TOTAL_BYTES = 32 * 1024 * 1024;

export interface LibraryFile {
  id: string;
  name: string;
  path: string;
  hash: string;
  addedAt: number;
  markdown?: string;
  assets?: string[];
  needsOcr?: boolean;
}

export class FileLibrary {
  private readonly state: ScopedState<LibraryFile[]>;
  constructor(private readonly root = STATE_DIR) {
    this.state = new ScopedState("documents", () => [], root);
  }
  list(key: string): LibraryFile[] { return this.state.get(key); }
  get(key: string, id: string): LibraryFile {
    if (!/^[a-f0-9-]{8,36}$/i.test(id)) throw new Error("文件编号至少需要 8 位");
    const matches = this.list(key).filter((file) => file.id.startsWith(id.toLowerCase()));
    if (matches.length !== 1) throw new Error("文件编号不存在或不唯一，请用 /files 查看");
    return matches[0];
  }
  async add(key: string, file: { name: string; path: string }, workspace: string): Promise<LibraryFile> {
    const bytes = await readFile(file.path);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const entries = this.list(key);
    const directory = join(workspace, ".weixin-files", scopeId(key));
    // 读-改-写存在理论竞态：同 key 并发 add 会后写覆盖先写。
    // 当前由 bridge 的 TaskQueue 按 key 串行化消息，同 key 不会并发；若未来放开需先加串行化。
    // 去重必须限定在当前项目目录内：切换项目后重新上传同一文件时，
    // 复用旧条目会把 A 项目的路径带进 B 项目，导致后续 sendFile 越界或内容串项目。
    // 命中去重前必须确认文件还在：用户清理过 .weixin-files 后重传同一文件，
    // 若复用指向已删除路径的记录，会每次都在转换阶段失败且永不恢复
    const existing = entries.find((entry) => entry.hash === hash && dirname(entry.path) === directory);
    if (existing && existsSync(existing.path)) return existing;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const safeName = basename(file.name.replace(/\\/g, "/")).replace(/[\x00-\x1f<>:"/\\|?*]/g, "_").replace(/[. ]+$/, "").slice(0, 120) || "document";
    const path = join(directory, `${id}-${safeName}`);
    await copyFile(file.path, path, 1);
    const entry = { id, name: file.name, path, hash, addedAt: Date.now() };
    this.state.set(key, [...entries, entry]);
    return entry;
  }
  update(key: string, id: string, patch: Partial<Pick<LibraryFile, "markdown" | "assets" | "needsOcr">>): void {
    const entry = this.get(key, id);
    this.state.set(key, this.list(key).map((item) => item.id === entry.id ? { ...item, ...patch } : item));
  }
  async search(key: string, query: string): Promise<Array<{ id: string; name: string; path: string; excerpt: string }>> {
    if (!query.trim()) throw new Error("检索词不能为空");
    const index = new MiniSearch({ fields: ["name", "text"], storeFields: ["name", "path", "text"],
      tokenize: (text) => text.match(/[\p{Script=Han}]|[\p{L}\p{N}_-]+/gu) ?? [] });
    // 只索引当前对话的资料，限制单次加载范围，避免大文件耗尽内存。
    // 单个文件已删除/不可读时跳过该文件，不能让一次 /files find 整体失败。
    let budget = SEARCH_TOTAL_BYTES;
    // 倒序：list() 是追加顺序，正序会让预算先被最旧文件吃掉，导致刚上传的资料反而搜不到
    for (const file of this.list(key).slice(-200).reverse()) {
      const path = file.markdown ?? file.path;
      if (!file.markdown && !/\.(md|txt|csv)$/i.test(file.name)) continue;
      try {
        const size = (await stat(path)).size;
        if (size > SEARCH_MAX_BYTES_PER_FILE || size > budget) continue;
        budget -= size;
        index.add({ id: file.id, name: file.name, path, text: await readFile(path, "utf8") });
      } catch (error) {
        // 单个文件不可读不应让整次检索失败，但要留下诊断线索
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") logger.debug(`[library] 检索跳过已删除文件：${path}`);
        else logger.warn(`[library] 检索跳过不可读文件：${path}：${String(error)}`);
      }
    }
    return index.search(query, { prefix: true, combineWith: "AND" }).slice(0, 8).map((hit) => {
      const text = String(hit.text);
      const term = query.trim().split(/\s+/)[0];
      const offset = Math.max(0, text.toLowerCase().indexOf(term.toLowerCase()) - 60);
      return { id: hit.id, name: String(hit.name), path: String(hit.path), excerpt: text.slice(offset, offset + 300) };
    });
  }
}
