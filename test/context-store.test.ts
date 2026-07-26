import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextStore } from "../src/ilink/context-store.js";

describe("ContextStore 持久化", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ctx-store-"));
    file = join(dir, "context.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("context_token 存取与持久化", () => {
    const store = new ContextStore(file);
    store.setContextToken("user-1", "ctx-token-1");
    expect(store.getContextToken("user-1")).toBe("ctx-token-1");
    expect(existsSync(file)).toBe(true);

    // 新实例从磁盘恢复（重启恢复）
    const store2 = new ContextStore(file);
    expect(store2.getContextToken("user-1")).toBe("ctx-token-1");
  });

  it("typing ticket 未过期可取", () => {
    const store = new ContextStore(file);
    store.setTypingTicket("user-1", "ticket-1", 60_000);
    expect(store.getTypingTicket("user-1")).toBe("ticket-1");
  });

  it("typing ticket 过期失效", () => {
    const store = new ContextStore(file);
    store.setTypingTicket("user-1", "ticket-1", -1); // 立即过期
    expect(store.getTypingTicket("user-1")).toBeUndefined();
  });

  it("knownUsers 返回有 context_token 的用户", () => {
    const store = new ContextStore(file);
    store.setContextToken("user-1", "ctx");
    store.setTypingTicket("user-2", "ticket", 60_000); // 仅 ticket 无 token
    expect(store.knownUsers()).toContain("user-1");
    expect(store.knownUsers()).not.toContain("user-2");
  });

  it("损坏的存储文件安全降级", () => {
    writeFileSync(file, "{ invalid json");
    const store = new ContextStore(file); // 不应抛错
    expect(store.knownUsers()).toEqual([]);
  });
});
