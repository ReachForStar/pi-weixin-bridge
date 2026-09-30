import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import MiniSearch from "minisearch";
import { STATE_DIR } from "../config.js";
import { ScopedState, scopeId } from "./state.js";

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
    const existing = entries.find((entry) => entry.hash === hash);
    if (existing) return existing;
    const directory = join(workspace, ".weixin-files", scopeId(key));
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
    for (const file of this.list(key).slice(-200)) {
      const path = file.markdown ?? file.path;
      if (!file.markdown && !/\.(md|txt|csv)$/i.test(file.name)) continue;
      if ((await stat(path)).size > 2 * 1024 * 1024) continue;
      index.add({ id: file.id, name: file.name, path, text: await readFile(path, "utf8") });
    }
    return index.search(query, { prefix: true, combineWith: "AND" }).slice(0, 8).map((hit) => {
      const text = String(hit.text);
      const term = query.trim().split(/\s+/)[0];
      const offset = Math.max(0, text.toLowerCase().indexOf(term.toLowerCase()) - 60);
      return { id: hit.id, name: String(hit.name), path: String(hit.path), excerpt: text.slice(offset, offset + 300) };
    });
  }
}
