import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";

afterEach(() => vi.unstubAllEnvs());

describe("对话与重置使用同一队列", () => {
  it("中断的排队消息不阻断 /new，重启后仍使用新会话", async () => {
    mkdirSync("tmp", { recursive: true });
    const root = resolve(mkdtempSync(join("tmp", "session-queue-")));
    const workspace = join(root, "workspace");
    vi.stubEnv("PI_WEIXIN_STATE_DIR", root);
    vi.stubEnv("PI_WEIXIN_WORKSPACE", workspace);
    vi.resetModules();
    const { PiSessionManager, ChatStoppedError } = await import("../src/pi/sessions.js");
    const { ConversationStore } = await import("../src/pi/conversation-store.js");
    const manager = new PiSessionManager();
    const controller = new AbortController();
    controller.abort();
    const stages: string[] = [];
    const first = manager.chat("当前对话", "请帮我完善一下这个项目", { signal: controller.signal });
    const second = manager.chat("当前对话", "增加重启后恢复对话", {
      signal: controller.signal, onProgress: (progress) => stages.push(progress.stage),
    });
    const failures = Promise.allSettled([first, second]);
    await manager.resetSession("当前对话");
    const results = await failures;
    expect(results.every((result) => result.status === "rejected" && result.reason instanceof ChatStoppedError)).toBe(true);
    expect(stages).toContain("queued");
    const store = new ConversationStore(join(root, "sessions"), workspace);
    const sessionId = store.open("当前对话").getSessionId();
    const restarted = new PiSessionManager();
    await restarted.resetSession("当前对话");
    expect(store.open("当前对话").getSessionId()).not.toBe(sessionId);
    expect(store.open("当前对话").buildSessionContext().messages).toEqual([]);
    expect(manager.busyCount()).toBe(0);
    manager.dispose();
    restarted.dispose();
  });
});
