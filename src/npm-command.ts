import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** 使用当前 Node 安装中的 npm JavaScript 入口，避免终端再次解释参数。 */
export function npmCommand(): string {
  const root = dirname(process.execPath);
  const manifest = createRequire(process.execPath).resolve("npm/package.json", { paths: [root, join(root, "..", "lib")] });
  return join(dirname(manifest), "bin", "npm-cli.js");
}
