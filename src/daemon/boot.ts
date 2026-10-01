// 自启在当前用户上下文运行，保持 pi 配置与账号凭据的访问权限。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { STATE_DIR, WORKSPACE, MODEL_REF } from "../config.js";
import { BIN_PATH, daemonStatus } from "./daemon.js";
import { runWindowsHelper, WINDOWS_HELPER } from "../platform.js";

const TASK_NAME = "pi-weixin-bridge";

// ---------- Windows：每用户登录计划任务 ----------

/** 注册开机自启任务（已存在则覆盖） */
function installBootWindows(): { ok: boolean; message: string } {
  if (!existsSync(WINDOWS_HELPER)) return { ok: false, message: "npm 包缺少 Windows 系统辅助脚本，请重新安装" };
  runWindowsHelper(["task-install", process.execPath, BIN_PATH, "start", STATE_DIR, WORKSPACE, MODEL_REF, process.env.PI_CODING_AGENT_DIR ?? ""]);
  return { ok: true, message: `已注册计划任务 ${TASK_NAME}（用户登录时隐藏启动，无需 PowerShell）` };
}

function uninstallBootWindows(): { ok: boolean; message: string } {
  runWindowsHelper(["task-remove"]);
  return { ok: true, message: `已移除计划任务 ${TASK_NAME}` };
}

// ---------- Linux：systemd 用户服务 ----------

const UNIT_NAME = `${TASK_NAME}.service`;
const UNIT_FILE = join(homedir(), ".config", "systemd", "user", UNIT_NAME);

/** 生成 systemd 用户服务单元内容（纯函数，便于单测）；含空格的路径加引号（systemd 按空白分词） */
export function renderSystemdUnit(nodePath: string, binPath: string, pidFile: string): string {
  const q = (s: string) => {
    if (/[\r\n\0]/.test(s)) throw new Error("自启路径包含无效字符");
    const escaped = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%");
    return /[\s"'\\]/.test(s) ? `"${escaped}"` : escaped;
  };
  return [
    "[Unit]",
    "Description=pi-weixin-bridge background daemon",
    "After=network-online.target",
    "",
    "[Service]",
    // Type=forking：`daemon start` 拉起 supervisor 后退出，systemd 经 PIDFile 接管 supervisor
    "Type=forking",
    `ExecStart=${q(nodePath)} ${q(binPath)} daemon start`,
    `ExecStop=${q(nodePath)} ${q(binPath)} daemon stop`,
    `Environment=${q(`PI_WEIXIN_STATE_DIR=${dirname(dirname(pidFile))}`)}`,
    `Environment=${q(`PI_WEIXIN_WORKSPACE=${WORKSPACE}`)}`,
    ...(MODEL_REF ? [`Environment=${q(`PI_WEIXIN_MODEL=${MODEL_REF}`)}`] : []),
    ...(process.env.PI_CODING_AGENT_DIR ? [`Environment=${q(`PI_CODING_AGENT_DIR=${process.env.PI_CODING_AGENT_DIR}`)}`] : []),
    "TimeoutStartSec=30",
    "TimeoutStopSec=20",
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
  const probe = spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf8", timeout: 60_000 });
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
      message: `systemd 用户会话不可用（${probe.stderr?.trim() || "daemon-reload 失败"}）。可手动运行 ` +
        "`pi-weixin-bridge daemon start`。",
    };
  }
  mkdirSync(dirname(UNIT_FILE), { recursive: true });
  writeFileSync(
    UNIT_FILE,
    renderSystemdUnit(process.execPath, BIN_PATH, join(STATE_DIR, "daemon", "supervisor.pid")),
    "utf8",
  );
  const reload = runSystemctl(["daemon-reload"]);
  if (!reload.ok) return { ok: false, message: `systemctl daemon-reload 失败: ${reload.output}` };
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
  if (!existsSync(UNIT_FILE)) return { ok: true, message: "未注册 systemd 用户服务" };
  const disabled = runSystemctl(["disable", TASK_NAME]);
  if (!disabled.ok) return { ok: false, message: `systemctl disable 失败: ${disabled.output}` };
  rmSync(UNIT_FILE, { force: true });
  const reload = runSystemctl(["daemon-reload"]);
  if (!reload.ok) return { ok: false, message: `systemctl daemon-reload 失败: ${reload.output}` };
  return { ok: true, message: `已移除 systemd 用户服务 ${TASK_NAME}` };
}

const AGENT_LABEL = "io.github.ReachForStar.pi-weixin-bridge";
const AGENT_FILE = join(homedir(), "Library", "LaunchAgents", `${AGENT_LABEL}.plist`);

export function launchAgentConfig(nodePath: string, binPath: string, stateDir: string, workspace: string): Record<string, unknown> {
  return { Label: AGENT_LABEL, ProgramArguments: [nodePath, binPath, "daemon", "supervise"], RunAtLoad: true,
    EnvironmentVariables: { PI_WEIXIN_STATE_DIR: stateDir, PI_WEIXIN_WORKSPACE: workspace,
      ...(MODEL_REF ? { PI_WEIXIN_MODEL: MODEL_REF } : {}),
      ...(process.env.PI_CODING_AGENT_DIR ? { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR } : {}) },
    StandardOutPath: join(stateDir, "daemon", "launch-agent.log"), StandardErrorPath: join(stateDir, "daemon", "launch-agent.log") };
}

function runLaunchctl(args: string[]): { ok: boolean; output: string } {
  const result = spawnSync("/bin/launchctl", args, { encoding: "utf8", timeout: 60_000 });
  return { ok: result.status === 0, output: result.error?.message ?? `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

function installBootDarwin(): { ok: boolean; message: string } {
  if (daemonStatus().running) return { ok: false, message: "macOS 注册自启前请先运行 daemon stop，避免 LaunchAgent 与已有 supervisor 冲突" };
  if (existsSync(AGENT_FILE)) {
    const removed = runLaunchctl(["unload", "-w", AGENT_FILE]);
    if (!removed.ok) return { ok: false, message: `卸载已有 LaunchAgent 失败: ${removed.output}` };
  }
  mkdirSync(dirname(AGENT_FILE), { recursive: true });
  mkdirSync(join(STATE_DIR, "daemon"), { recursive: true });
  // 使用系统 plutil 转换标准 JSON，避免自行生成或解析 plist XML。
  const converted = spawnSync("/usr/bin/plutil", ["-convert", "xml1", "-o", AGENT_FILE, "-"], {
    input: JSON.stringify(launchAgentConfig(process.execPath, BIN_PATH, STATE_DIR, WORKSPACE)), encoding: "utf8", timeout: 30_000,
  });
  if (converted.error || converted.status !== 0) return { ok: false, message: `生成 LaunchAgent 失败: ${converted.error?.message ?? converted.stderr}` };
  const loaded = runLaunchctl(["load", "-w", AGENT_FILE]);
  return { ok: loaded.ok, message: loaded.ok ? `已注册 macOS 登录自启（${AGENT_FILE}）；请用 status 检查后台` : `注册 LaunchAgent 失败: ${loaded.output}` };
}

function uninstallBootDarwin(): { ok: boolean; message: string } {
  if (!existsSync(AGENT_FILE)) return { ok: true, message: "未注册 macOS LaunchAgent" };
  const unloaded = runLaunchctl(["unload", "-w", AGENT_FILE]);
  if (!unloaded.ok) return { ok: false, message: `移除 LaunchAgent 失败: ${unloaded.output}` };
  rmSync(AGENT_FILE);
  return { ok: true, message: "已移除 macOS 登录自启；后台状态请用 status 查看" };
}

// ---------- 对外入口 ----------

export function installBootTask(): { ok: boolean; message: string } {
  if (process.platform === "win32") return installBootWindows();
  if (process.platform === "linux") return installBootLinux();
  if (process.platform === "darwin") return installBootDarwin();
  return { ok: false, message: "仅支持 Windows、macOS 和 Linux 登录自启" };
}

export function uninstallBootTask(): { ok: boolean; message: string } {
  if (process.platform === "win32") return uninstallBootWindows();
  if (process.platform === "linux") return uninstallBootLinux();
  if (process.platform === "darwin") return uninstallBootDarwin();
  return { ok: false, message: "仅支持 Windows、macOS 和 Linux 登录自启" };
}
