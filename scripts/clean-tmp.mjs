// 清理测试在仓库内 tmp/ 留下的临时目录（测试不总是自清理，长期累积可达数百个）。
// 仅删除 tmp/ 下一层的已知测试前缀目录，其余内容保持不动。
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const TMP_DIR = "tmp";
const TEST_PREFIXES = [
  "account-reliability-", "bridge-reliability-", "conversation-test-", "document-test-",
  "feature-check-", "notification-test-", "piwx-media-", "piwx-wiz-", "queue-documents",
  "session-queue", "sup-count-reset-", "tool-check", "wizard-",
];

let removed = 0;
try {
  for (const name of readdirSync(TMP_DIR)) {
    if (!TEST_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const target = join(TMP_DIR, name);
    try {
      if (!statSync(target).isDirectory()) continue;
      rmSync(target, { recursive: true, force: true });
      removed++;
    } catch {
      // 单个目录被占用时跳过，不影响测试运行
    }
  }
} catch {
  // tmp/ 不存在属正常情况
}
if (removed) console.log(`已清理 ${removed} 个测试临时目录`);
