// 从 CHANGELOG.md 提取指定版本的段落，作为 GitHub Release notes 输出到 stdout。
// 用法: node scripts/extract-changelog.mjs <version>
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version) {
  console.error("用法: node scripts/extract-changelog.mjs <version>");
  process.exit(1);
}

// 相对脚本定位 CHANGELOG，与 CWD 无关（CI 从任意目录调用也正确）
const changelogPath = join(dirname(fileURLToPath(import.meta.url)), "..", "CHANGELOG.md");
let content;
try {
  content = readFileSync(changelogPath, "utf8");
} catch (err) {
  console.error(`无法读取 CHANGELOG.md: ${err.message}`);
  process.exit(1);
}

const lines = content.split("\n");

// 全转义正则元字符，防止版本号含特殊字符时模式被破坏
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const headerRe = new RegExp(`^## \\[${escaped}\\]`);
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

if (!capturing) {
  console.error(`未在 CHANGELOG.md 中找到版本 ${version} 的段落`);
  process.exit(1);
}
const notes = out.join("\n").trim();
console.log(notes || `Release v${version}`);
