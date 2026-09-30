import { describe, it, expect } from "vitest";
import {
  escapeMarkdown,
  bold,
  inlineCode,
  codeBlock,
  link,
  bulletList,
  orderedList,
  chunkText,
} from "../src/message/markdown.js";

describe("markdown 格式化", () => {
  it("转义特殊字符", () => {
    expect(escapeMarkdown("a*b_c")).toBe("a\\*b\\_c");
  });
  it("加粗 / 行内代码 / 链接", () => {
    expect(bold("x")).toBe("**x**");
    expect(inlineCode("x")).toBe("`x`");
    expect(link("t", "http://u")).toBe("[t](http://u)");
  });
  it("代码块", () => {
    expect(codeBlock("code", "js")).toBe("```js\ncode\n```");
  });
  it("列表", () => {
    expect(bulletList(["a", "b"])).toBe("- a\n- b");
    expect(orderedList(["a", "b"])).toBe("1. a\n2. b");
  });
});

describe("chunkText 分块", () => {
  it("拒绝可能导致无法前进的长度", () => {
    for (const length of [0, -1, 1, 2.5, NaN, Infinity]) {
      expect(() => chunkText("", length)).toThrow(RangeError);
    }
  });
  it("硬切保留表情字符并遵守长度限制", () => {
    const text = "中文😀微信🌏消息";
    const chunks = chunkText(text, 3);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => chunk.length <= 3 && chunk.isWellFormed())).toBe(true);
  });
  it("短文本不分块", () => {
    expect(chunkText("short", 100)).toEqual(["short"]);
  });
  it("长文本按段落分块", () => {
    const text = "para1\n\npara2\n\npara3";
    const chunks = chunkText(text, 12);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n\n").replace(/\n+/g, "\n")).toContain("para1");
  });
  it("单段超长硬切", () => {
    const text = "x".repeat(50);
    const chunks = chunkText(text, 20);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 20)).toBe(true);
  });
});
