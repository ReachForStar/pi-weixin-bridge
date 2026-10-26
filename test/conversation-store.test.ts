import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ConversationStore } from "../src/pi/conversation-store.js";

function directories() {
  mkdirSync("tmp", { recursive: true });
  const root = mkdtempSync(join("tmp", "conversation-test-"));
  const workspace = resolve(root, "workspace");
  mkdirSync(workspace);
  return { root: join(root, "sessions"), workspace, temporary: root };
}

describe("真实 SDK 会话恢复", () => {
  it("保存用户消息并由新的 Node 进程读取上下文", () => {
    const { root, workspace, temporary } = directories();
    const store = new ConversationStore(root, workspace);
    const key = JSON.stringify(["微信账号", "当前对话"]);
    const session = store.open(key);
    const text = "增加重启后恢复对话、任务进度与失败通知";
    session.appendMessage({ role: "user", content: text, timestamp: Date.now() });
    const script = join(temporary, "resume.mjs");
    writeFileSync(script, [
      'import { SessionManager } from "@earendil-works/pi-coding-agent";',
      'const context = SessionManager.open(process.argv[2]).buildSessionContext();',
      'process.stdout.write(JSON.stringify(context.messages));',
    ].join("\n"), "utf8");
    const restored = JSON.parse(execFileSync(process.execPath, [script, session.getSessionFile()!], {
      encoding: "utf8",
    }));
    expect(restored).toHaveLength(1);
    expect(restored[0].content).toBe(text);
    expect(new ConversationStore(root, workspace).open(key).getSessionId()).toBe(session.getSessionId());
  });

  it("新建对话后立即重启不恢复旧上下文，并保留旧记录", () => {
    const { root, workspace } = directories();
    const store = new ConversationStore(root, workspace);
    const old = store.open("当前对话");
    old.appendMessage({ role: "user", content: "请帮我完善一下这个项目", timestamp: Date.now() });
    const fresh = store.reset("当前对话");
    const restored = new ConversationStore(root, workspace).open("当前对话");
    expect(restored.getSessionId()).toBe(fresh.getSessionId());
    expect(restored.buildSessionContext().messages).toEqual([]);
    expect(readFileSync(old.getSessionFile()!, "utf8")).toContain("请帮我完善一下这个项目");
  });

  it("按账号、对话和工作目录隔离，路径字符不会逃出目录", () => {
    const { root, workspace } = directories();
    const first = new ConversationStore(root, workspace).open(JSON.stringify(["账号一", "../同一对话"]));
    const second = new ConversationStore(root, workspace).open(JSON.stringify(["账号二", "../同一对话"]));
    const third = new ConversationStore(root, `${workspace}-other`).open(JSON.stringify(["账号一", "../同一对话"]));
    expect(new Set([first.getSessionId(), second.getSessionId(), third.getSessionId()]).size).toBe(3);
    expect(readdirSync(root).every((directory) => /^[a-f0-9]{64}$/.test(directory))).toBe(true);
  });

  it("损坏的当前索引明确报错，显式新建可恢复使用", () => {
    const { root, workspace } = directories();
    const store = new ConversationStore(root, workspace);
    const session = store.open("当前对话");
    const pointer = join(session.getSessionDir(), "current.json");
    writeFileSync(pointer, JSON.stringify({ file: "../outside.jsonl" }), "utf8");
    expect(() => store.open("当前对话")).toThrow("索引无效");
    const fresh = store.reset("当前对话");
    expect(store.open("当前对话").getSessionId()).toBe(fresh.getSessionId());
  });
});
