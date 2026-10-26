// PID 身份校验：PID 会被系统复用，仅凭 kill(pid,0) 存活无法证明「这就是我们的进程」。
// 记录 (pid, 启动时间) 二元组，杀进程前比对启动时间，避免误杀无关进程（含整进程组）。
//
// 重要约束：PID 文件本身必须保持**纯数字**。systemd 的 `PIDFile=` 用 parse_pid 解析，
// 只接受十进制数字，写入 `12345:67890123` 会让它打 "Failed to parse PID from file"，
// Type=forking 拿不到 main PID 而退化为 GuessMainPID。因此启动时间放到旁路文件 `<pidfile>.start`。
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { logger } from "../logger/index.js";

/** PID 记录：pid 必填，启动时间为可选（采集失败时退化为「不校验」） */
export interface PidStamp {
  pid: number;
  startTime?: string;
}

/** 启动时间旁路文件路径 */
export function startTimeFile(pidFile: string): string {
  return `${pidFile}.start`;
}

function linuxStartTime(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // comm 字段可能含空格与括号，必须以最后一个 ")" 为界切分
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    // 原字段 22（starttime）在 comm 之后的第 20 项
    const value = fields[19];
    return value && /^\d+$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function darwinStartTime(pid: number): string | undefined {
  try {
    // lstart 形如 "Mon Oct 26 10:00:00 2026"；日/月名受 LC_TIME 影响，
    // 必须固定 locale，否则 supervisor 环境与交互式 shell 采集结果不同会误判 mismatch。
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8", timeout: 5_000, windowsHide: true,
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

function win32StartTime(pid: number): string | undefined {
  try {
    const out = execFileSync("powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command",
        `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime.ToFileTimeUtc()`],
      { encoding: "utf8", timeout: 10_000, windowsHide: true }).trim();
    return /^\d+$/.test(out) ? out : undefined;
  } catch {
    return undefined;
  }
}

/** 采集指定进程的启动时间标记；平台不支持或采集失败时返回 undefined */
export function captureStartTime(pid: number): string | undefined {
  if (process.platform === "linux") return linuxStartTime(pid);
  if (process.platform === "darwin") return darwinStartTime(pid);
  if (process.platform === "win32") return win32StartTime(pid);
  return undefined;
}

/** 判断 pid 当前进程的启动时间是否与记录一致；无法判定时返回 "unknown" */
export function matchesStartTime(pid: number, recorded: string | undefined): "match" | "mismatch" | "unknown" {
  if (!recorded) return "unknown";
  const current = captureStartTime(pid);
  if (current === undefined) return "unknown";
  return current === recorded ? "match" : "mismatch";
}

/**
 * 写入 PID 文件（纯数字，满足 systemd PIDFile 契约）并在旁路文件记录启动时间。
 * pid 为 undefined（spawn 失败）时删除两个文件，避免留下会被判为损坏的锁。
 */
export function writePidFiles(pidFile: string, pid: number | undefined): void {
  if (pid === undefined) {
    for (const file of [pidFile, startTimeFile(pidFile)]) {
      try { unlinkSync(file); } catch { /* 不存在即可 */ }
    }
    return;
  }
  writeFileSync(pidFile, String(pid), { encoding: "utf8", mode: 0o600 });
  const startTime = captureStartTime(pid);
  const sidecar = startTimeFile(pidFile);
  if (startTime) {
    try {
      writeFileSync(sidecar, startTime, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      // 采集到却写不进旁路文件：身份校验会退化，明确告警一次而不是静默失效
      logger.warn(`PID 启动时间写入失败（身份校验将退化）：${sidecar}：${String(error)}`);
    }
  } else {
    // 平台不支持或采集失败：清理旧旁路，避免与新 pid 配对出错误的身份
    try { unlinkSync(sidecar); } catch { /* 不存在即可 */ }
    logger.warn(`无法采集 PID ${pid} 的启动时间（该平台/环境不支持），PID 复用防护不可用`);
  }
}

/** 读取旁路文件中的启动时间 */
export function readStartTime(pidFile: string): string | undefined {
  const sidecar = startTimeFile(pidFile);
  try {
    if (!existsSync(sidecar)) return undefined;
    const value = readFileSync(sidecar, "utf8").trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

/**
 * 解析 PID 文件内容。
 * 兼容历史上写入过 `<pid>:<startTime>` 的版本（读取时容忍，写入时始终为纯数字）。
 * 非法内容返回 undefined，调用方按「无锁」处理。
 */
export function parsePidFile(text: string): PidStamp | undefined {
  const trimmed = text.trim();
  const match = /^(\d+)(?::(.+))?$/.exec(trimmed);
  if (!match) return undefined;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid < 1) return undefined;
  return { pid, startTime: match[2] || undefined };
}
