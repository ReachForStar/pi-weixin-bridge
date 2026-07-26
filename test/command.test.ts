import { describe, it, expect, vi } from "vitest";
import { SlashCommandHandler } from "../src/command.js";

function makeHandler() {
  const mockPi = { resetSession: vi.fn().mockResolvedValue(undefined) } as any;
  const mockContextStore = { knownUsers: () => ["user-1", "user-2"] } as any;
  const handler = new SlashCommandHandler(mockPi, mockContextStore, "test-account");
  return { handler, mockPi };
}

describe("SlashCommandHandler", () => {
  it("/help 返回帮助", async () => {
    const { handler } = makeHandler();
    const reply = await handler.handle("/help", { key: "k" });
    expect(reply).toContain("/help");
    expect(reply).toContain("/status");
    expect(reply).toContain("/new");
  });

  it("/status 返回状态", async () => {
    const { handler } = makeHandler();
    const reply = await handler.handle("/status", { key: "k" });
    expect(reply).toContain("test-account");
    expect(reply).toContain("2 个");
  });

  it("/new 重置会话", async () => {
    const { handler, mockPi } = makeHandler();
    const reply = await handler.handle("/new", { key: "user-1" });
    expect(mockPi.resetSession).toHaveBeenCalledWith("user-1");
    expect(reply).toContain("新对话");
  });

  it("非斜杠命令返回 null", async () => {
    const { handler } = makeHandler();
    expect(await handler.handle("hello", { key: "k" })).toBeNull();
  });

  it("未知斜杠命令返回 null（交给 pi）", async () => {
    const { handler } = makeHandler();
    expect(await handler.handle("/unknown-cmd", { key: "k" })).toBeNull();
  });
});
