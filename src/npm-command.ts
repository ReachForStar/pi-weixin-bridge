import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** 使用当前 Node 安装中的 npm JavaScript 入口，避免终端再次解释参数。 */
export function npmCommand(): string {
  const root = dirname(process.execPath);
  // 官方安装包：npm 在 <root>/../lib；Homebrew（分离 formula）：<prefix>/Cellar/node/<ver>/bin → <prefix>/lib。
  const paths = [root, join(root, "..", "lib"), join(root, "..", "..", "..", "..", "lib")];
  const manifest = createRequire(process.execPath).resolve("npm/package.json", { paths });
  return join(dirname(manifest), "bin", "npm-cli.js");
}
