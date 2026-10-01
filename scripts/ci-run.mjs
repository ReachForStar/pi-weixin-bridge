import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const command = JSON.parse(readFileSync(process.argv[2], "utf8"));
const root = dirname(process.execPath);
const manifest = createRequire(process.execPath).resolve("npm/package.json", { paths: [root, join(root, "..", "lib")] });
const args = command.npm ? [join(dirname(manifest), "bin", "npm-cli.js"), ...command.npm] : command.node;
if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) throw new Error("CI 命令参数无效");
const result = spawnSync(process.execPath, args, { stdio: "inherit", windowsHide: true, timeout: 300_000 });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
