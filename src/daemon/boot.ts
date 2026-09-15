// 开机自启：注册每用户登录计划任务（免管理员，隐藏窗口）。
// git/clone 安装走 start-service.ps1（路径稳定）；npx 等无 ps1 的安装回退 npx 命令。
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TASK_NAME = "pi-weixin-bridge";
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function runPowershell(script: string, args: string[]): { ok: boolean; output: string } {
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
    { cwd: PKG_ROOT, encoding: "utf8", timeout: 60_000 },
  );
  return {
    ok: r.status === 0,
    output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(),
  };
}

/** 注册开机自启任务（已存在则覆盖） */
export function installBootTask(): { ok: boolean; message: string } {
  const script = join(PKG_ROOT, "scripts", "install-boot.ps1");
  if (!existsSync(script)) {
    return { ok: false, message: `未找到 ${script}` };
  }
  const ps1 = join(PKG_ROOT, "start-service.ps1");
  let execute: string;
  let argument: string;
  if (existsSync(ps1)) {
    execute = "powershell.exe";
    argument = `-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${ps1}"`;
  } else {
    // npx 临时安装：ps1 不在包内，用 npx 命令拉起（npx 缓存复用已装版本）
    execute = "cmd.exe";
    argument = "/c npx -y pi-weixin-bridge daemon start";
  }
  const r = runPowershell(script, [execute, argument]);
  return {
    ok: r.ok,
    message: r.ok ? `已注册计划任务 ${TASK_NAME}（用户登录时隐藏启动）` : `注册失败: ${r.output}`,
  };
}

/** 移除开机自启任务（不存在时视为成功） */
export function uninstallBootTask(): { ok: boolean; message: string } {
  const script = join(PKG_ROOT, "scripts", "uninstall-boot.ps1");
  if (!existsSync(script)) {
    return { ok: false, message: `未找到 ${script}` };
  }
  const r = runPowershell(script, []);
  return {
    ok: r.ok || /not found|找不到|does not exist/i.test(r.output),
    message: r.ok ? `已移除计划任务 ${TASK_NAME}` : `移除失败: ${r.output}`,
  };
}
