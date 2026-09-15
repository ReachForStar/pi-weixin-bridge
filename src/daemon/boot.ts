// 开机自启（跨平台）：
// - Windows：每用户登录计划任务（免管理员，隐藏窗口）
// - Linux：systemd 用户服务（用户登录时启动；免 root）
// 两者都在当前用户上下文运行，可正常读取用户主目录下的 pi 配置与账号凭据。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE_DIR } from "../config.js";
import { BIN_PATH } from "./daemon.js";

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

// ---------- Windows：每用户登录计划任务 ----------

/** 注册开机自启任务（已存在则覆盖） */
function installBootWindows(): { ok: boolean; message: string } {
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

function uninstallBootWindows(): { ok: boolean; message: string } {
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

// ---------- Linux：systemd 用户服务 ----------

const UNIT_NAME = `${TASK_NAME}.service`;
const UNIT_FILE = join(homedir(), ".config", "systemd", "user", UNIT_NAME);

/** 生成 systemd 用户服务单元内容（纯函数，便于单测）；含空格的路径加引号（systemd 按空白分词） */
export function renderSystemdUnit(nodePath: string, binPath: string, pidFile: string): string {
  const q = (s: string) => (/[\s"']/.test(s) ? `"${s}"` : s);
  return [
    "[Unit]",
    "Description=pi-weixin-bridge background daemon",
    "After=network-online.target",
    "",
    "[Service]",
    // Type=forking：`daemon start` 拉起 supervisor 后退出，systemd 经 PIDFile 接管 supervisor
    "Type=forking",
    `ExecStart=${q(nodePath)} ${q(binPath)} daemon start`,
    `PIDFile=${q(pidFile)}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function runSystemctl(args: string[]): { ok: boolean; output: string } {
  const r = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8", timeout: 60_000 });
  return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function installBootLinux(): { ok: boolean; message: string } {
  // 探测 systemd 用户会话是否可用（WSL 未启用 systemd 时 daemon-reload 会失败）
  const probe = spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf8" });
  if (probe.error) {
    return {
      ok: false,
      message:
        "未找到 systemctl（WSL 未启用 systemd 或系统不支持）。可手动在登录后运行 `pi-weixin-bridge daemon start`。",
    };
  }
  if (probe.status !== 0) {
    return {
      ok: false,
      message: `systemd 用户会话不可用（${probe.output || "daemon-reload 失败"}）。可手动运行 ` +
        "`pi-weixin-bridge daemon start`。",
    };
  }
  mkdirSync(dirname(UNIT_FILE), { recursive: true });
  writeFileSync(
    UNIT_FILE,
    renderSystemdUnit(process.execPath, BIN_PATH, join(STATE_DIR, "daemon", "supervisor.pid")),
    "utf8",
  );
  runSystemctl(["daemon-reload"]);
  const enable = runSystemctl(["enable", TASK_NAME]);
  if (!enable.ok) {
    return { ok: false, message: `systemctl enable 失败: ${enable.output}` };
  }
  return {
    ok: true,
    message:
      `已注册 systemd 用户服务 ${TASK_NAME}（用户登录时启动，unit: ${UNIT_FILE}）。\n` +
      "   如需未登录时也随开机启动，请管理员执行: loginctl enable-linger <用户名>",
  };
}

function uninstallBootLinux(): { ok: boolean; message: string } {
  runSystemctl(["disable", TASK_NAME]); // 不 --now：只影响自启，不动正在运行的服务
  rmSync(UNIT_FILE, { force: true });
  runSystemctl(["daemon-reload"]);
  return { ok: true, message: `已移除 systemd 用户服务 ${TASK_NAME}` };
}

// ---------- 对外入口 ----------

export function installBootTask(): { ok: boolean; message: string } {
  return process.platform === "win32" ? installBootWindows() : installBootLinux();
}

export function uninstallBootTask(): { ok: boolean; message: string } {
  return process.platform === "win32" ? uninstallBootWindows() : uninstallBootLinux();
}
