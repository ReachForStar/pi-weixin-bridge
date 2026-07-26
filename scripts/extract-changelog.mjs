// 从 CHANGELOG.md 提取指定版本的段落，作为 GitHub Release notes 输出到 stdout。
// 用法: node scripts/extract-changelog.mjs <version>
import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("用法: node scripts/extract-changelog.mjs <version>");
  process.exit(1);
}

const content = readFileSync("CHANGELOG.md", "utf8");
const lines = content.split("\n");

// 匹配 "## [1.0.0]" 形式的版本标题（转义点号）
const headerRe = new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`);
const nextHeaderRe = /^## \[/;

let capturing = false;
const out = [];
for (const line of lines) {
  if (headerRe.test(line)) {
    capturing = true;
    continue; // 跳过版本标题行本身
  }
  if (capturing && nextHeaderRe.test(line)) break; // 到达下一个版本段落
  if (capturing) out.push(line);
}

const notes = out.join("\n").trim();
console.log(notes || `Release v${version}`);
