import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageFile = new URL("../package.json", import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const base = process.env.RELEASE_BASE;
if (!base || !/^[a-f0-9]{40}$/.test(base)) {
  throw new Error("RELEASE_BASE 必须为推送前的完整提交编号");
}
const current = JSON.parse(readFileSync(packageFile, "utf8"));
if (typeof current.version !== "string" || /[\r\n]/.test(current.version)) {
  throw new Error("package.json 版本号无效");
}
// 新建分支没有可比较版本，避免首次推送意外发布。
const previous = base === "0".repeat(40) ? null : JSON.parse(
  execFileSync("git", ["show", `${base}:package.json`], { cwd: root, encoding: "utf8" }),
);
const changed = previous !== null && previous.version !== current.version;
const output = `version=${current.version}\nchanged=${changed}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output, "utf8");
else process.stdout.write(output);
