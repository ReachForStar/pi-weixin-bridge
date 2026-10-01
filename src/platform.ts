import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const WINDOWS_HELPER = fileURLToPath(new URL("../scripts/windows-helper.js", import.meta.url));

export function runWindowsHelper(args: string[], script = WINDOWS_HELPER): string {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`Windows 系统工具执行失败（退出码 ${result.status}）：${result.error?.message ?? result.stderr ?? ""} ${result.stdout ?? ""}`);
  return result.stdout.trim();
}
