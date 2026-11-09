// 清理测试在仓库内 tmp/ 留下的临时目录（测试不总是自清理，长期累积可达数百个）。
// 仅删除 tmp/ 下一层的已知测试前缀目录，其余内容保持不动。
import { lstatSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 以脚本自身位置定位仓库根，避免从其他工作目录执行时误删别处的 tmp/
const TMP_DIR = join(fileURLToPath(new URL("..", import.meta.url)), "tmp");
// 全部以 "-" 结尾：避免 startsWith 误匹配合法目录（如 tool-check-xxx 之外的用户内容），
// 本脚本会做递归删除，前缀过宽会误删用户数据。
const TEST_PREFIXES = [
  "account-reliability-", "bridge-reliability-", "config-cli-", "config-input-",
  "conversation-test-", "document-test-", "feature-check-", "model-check-",
  "notification-test-", "pidcheck-", "piwx-media-", "piwx-wiz-", "queue-documents-",
  "session-queue-", "tool-check-", "wizard-", "orphan-stop-", "sup-graceful-", "sup-force-",
];

let removed = 0;
let tmpIsDirectory = false;
try {
  // tmp/ 本身必须是真实目录：若它是符号链接，递归删除会越出仓库边界
  tmpIsDirectory = lstatSync(TMP_DIR).isDirectory();
} catch {
  // tmp/ 不存在属正常情况
}
if (tmpIsDirectory) {
  for (const name of readdirSync(TMP_DIR)) {
    if (!TEST_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const target = join(TMP_DIR, name);
    try {
      // lstat 不跟随符号链接：tmp/ 下的链接可能指向仓库外，递归删除必须跳过
      if (!lstatSync(target).isDirectory()) continue;
      rmSync(target, { recursive: true, force: true });
      removed++;
    } catch {
      // 单个目录被占用时跳过，不影响测试运行
    }
  }
}
if (removed) console.log(`已清理 ${removed} 个测试临时目录`);
