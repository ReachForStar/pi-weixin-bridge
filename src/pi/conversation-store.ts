import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { STATE_DIR, WORKSPACE } from "../config.js";

export class ConversationStore {
  constructor(
    private readonly root = join(STATE_DIR, "sessions"),
    private readonly workspace = WORKSPACE,
  ) {}

  private directory(key: string): string {
    if (!key) throw new Error("对话标识不能为空");
    const hash = createHash("sha256").update(JSON.stringify([resolve(this.workspace), key])).digest("hex");
    const directory = join(this.root, hash);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      chmodSync(this.root, 0o700);
      chmodSync(directory, 0o700);
    }
    return directory;
  }

  open(key: string): SessionManager {
    const directory = this.directory(key);
    const pointer = join(directory, "current.json");
    if (!existsSync(pointer)) return this.reset(key);
    const current: unknown = JSON.parse(readFileSync(pointer, "utf8"));
    if (!current || typeof current !== "object" || !("file" in current)
      || typeof current.file !== "string" || basename(current.file) !== current.file
      || /[\\/]/.test(current.file) || !current.file.endsWith(".jsonl")) {
      throw new Error("对话记录索引无效，请检查服务日志或使用 /new 开始新对话");
    }
    const file = join(directory, current.file);
    if (!existsSync(file)) throw new Error("当前对话记录缺失，请使用 /new 开始新对话");
    return SessionManager.open(file, directory, this.workspace);
  }

  reset(key: string): SessionManager {
    const directory = this.directory(key);
    const session = SessionManager.create(this.workspace, directory);
    const file = session.getSessionFile();
    if (!file) throw new Error("无法创建持久对话记录");
    // SDK 默认等到助手回复才首次保存，先保存真实会话头，保证 /new 后立即重启也不会恢复旧对话。
    writeFileSync(file, `${JSON.stringify(session.getHeader())}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const opened = SessionManager.open(file, directory, this.workspace);
    const temporary = join(directory, `current-${randomUUID()}.tmp`);
    writeFileSync(temporary, JSON.stringify({ file: basename(file) }), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, join(directory, "current.json"));
    return opened;
  }
}
