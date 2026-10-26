// PID 身份校验：PID 会被系统复用，仅凭 kill(pid,0) 存活无法证明「这就是我们的进程」。
// 记录 (pid, 启动时间) 二元组，杀进程前比对启动时间，避免误杀无关进程（含整进程组）。
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

export interface PidStamp {
  pid: number;
  /** 进程启动时间标记；不同平台语义不同，仅用于「同一进程」判定 */
  startTime: string;
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
    // lstart 形如 "Mon Oct 26 10:00:00 2026"，稳定且不依赖 locale 数字格式
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8", timeout: 5_000, windowsHide: true,
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

/** 采集当前进程的启动时间标记；平台不支持时返回 undefined（调用方应退化为「不校验」） */
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
 * PID 文件内容格式：`<pid>` 或 `<pid>:<startTime>`。
 * 兼容旧版纯数字文件；带启动时间时才能识别 PID 复用。
 */
export function formatPidFile(pid: number): string {
  const startTime = captureStartTime(pid);
  return startTime ? `${pid}:${startTime}` : String(pid);
}

/** 解析 PID 文件内容；非法返回 undefined（调用方按「无锁」处理），与 readProcessId 语义一致 */
export function parsePidFile(text: string): { pid: number; startTime?: string } | undefined {
  const trimmed = text.trim();
  const match = /^(\d+)(?::(.+))?$/.exec(trimmed);
  if (!match) return undefined;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid < 1) return undefined;
  return { pid, startTime: match[2] || undefined };
}
