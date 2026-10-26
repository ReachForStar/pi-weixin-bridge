import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STATE_DIR } from "../config.js";

export function scopeId(key: string): string {
  if (!key) throw new Error("会话标识不能为空");
  return createHash("sha256").update(key).digest("hex");
}

export function readJson<T>(file: string, empty: T): T {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as T : empty;
}

export function saveJson(file: string, value: unknown): void {
  const parent = dirname(file);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, file);
}

export class ScopedState<T> {
  constructor(private readonly category: string, private readonly empty: () => T, private readonly root = STATE_DIR) {}
  private file(key: string): string { return join(this.root, this.category, `${scopeId(key)}.json`); }
  get(key: string): T { return readJson(this.file(key), this.empty()); }
  set(key: string, value: T): void { saveJson(this.file(key), value); }
}
