// 进程统计（pm2 list 风格）：cpu%（两次采样差值）/ 内存 / 运行时长，跨平台。
// Windows 用 pwsh Get-Process，Linux 读 /proc，macOS 用 ps。零第三方依赖。
import { spawnSync } from "node:child_process";
import { cpus } from "node:os";
import { readFileSync } from "node:fs";

export interface ProcStats {
  cpuPct: number;
  memBytes: number;
  uptimeSec: number;
}

/** 单次采样：累计 CPU 秒数 / 工作集内存 / 已运行秒数 */
interface Sample {
  cpuSec: number;
  memBytes: number;
  uptimeSec: number;
}

function sampleWindows(pid: number): Sample | null {
  // 兼容 PowerShell 5.1（无 ToUnixTimeMilliseconds）：直接用 (Get-Date)-StartTime 算运行时长
  const cmd =
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue;` +
    ` if ($p) { "{0}|{1}|{2}" -f $p.CPU, $p.WorkingSet64, ((Get-Date) - $p.StartTime).TotalSeconds }`;
  const r = spawnSync("pwsh", ["-NoProfile", "-Command", cmd], { encoding: "utf8", timeout: 8000 });
  const line = (r.stdout ?? "").trim();
  if (!line) return null;
  const [cpu, mem, up] = line.split("|");
  const cpuSec = Number(cpu);
  const memBytes = Number(mem);
  const uptimeSec = Number(up);
  if (!Number.isFinite(cpuSec) || !Number.isFinite(memBytes) || !Number.isFinite(uptimeSec)) return null;
  return { cpuSec, memBytes, uptimeSec };
}

function sampleLinux(pid: number): Sample | null {
  try {
    // stat 字段 14/15 = utime/stime（clock ticks），字段 22 = starttime（开机后 ticks）
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // 字段 1 是 pid，字段 2 是 comm（可能含空格），从最后括号后的数字开始解析
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    const ticks = Number(fields[11]) + Number(fields[12]); // 去掉前 2 字段后的第 12/13 位 = 原 14/15
    const starttimeTicks = Number(fields[19]); // 原字段 22
    const btime = Number(readFileSync("/proc/stat", "utf8").match(/^btime (\d+)/m)?.[1] ?? 0);
    const clkTck = 100;
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const memBytes = Number(status.match(/VmRSS:\s+(\d+) kB/m)?.[1] ?? 0) * 1024;
    const nowSec = Date.now() / 1000;
    return {
      cpuSec: ticks / clkTck,
      memBytes,
      uptimeSec: Math.max(0, nowSec - (btime + starttimeTicks / clkTck)),
    };
  } catch {
    return null;
  }
}

function sampleDarwin(pid: number): Sample | null {
  // ps: %cpu（进程生命周期均值） rss(kb) etime(DDDHH:MM:SS)
  const r = spawnSync("ps", ["-o", "pcpu=,rss=,etime=,lstart=", "-p", String(pid)], { encoding: "utf8" });
  const line = (r.stdout ?? "").trim();
  if (!line) return null;
  const [cpu, mem, etime] = line.split(/\s+/);
  const cpuNum = Number(cpu);
  const memBytes = Number(mem) * 1024;
  const uptimeSec = parseEtime(etime ?? "");
  if (!Number.isFinite(cpuNum) || !Number.isFinite(memBytes) || !Number.isFinite(uptimeSec)) return null;
  return { cpuSec: cpuNum, memBytes, uptimeSec };
}

/** etime 格式 [[DD-]HH:]MM:SS → 秒 */
export function parseEtime(etime: string): number {
  const m = etime.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/** 进程统计：两次采样（500ms 间隔）求 CPU 占比；进程不存在返回 null */
export async function procStats(pid: number): Promise<ProcStats | null> {
  const sample =
    process.platform === "win32"
      ? sampleWindows
      : process.platform === "linux"
        ? sampleLinux
        : sampleDarwin;
  const a = sample(pid);
  if (!a) return null;
  await new Promise((r) => setTimeout(r, 500));
  const b = sample(pid);
  if (!b) return null;
  const cpuPct = Math.max(0, ((b.cpuSec - a.cpuSec) / 0.5 / cpus().length) * 100);
  return { cpuPct, memBytes: b.memBytes, uptimeSec: Math.max(0, b.uptimeSec) };
}

// ---- 格式化工具 ----

export function fmtMemory(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}mb`;
}

export function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${Math.floor(sec % 60)}s`;
  return `${Math.floor(sec)}s`;
}

export interface StatusRow {
  id: number;
  name: string;
  mode: string;
  restarts: number;
  online: boolean;
  pid?: number;
  cpuPct?: number;
  memBytes?: number;
  uptimeSec?: number;
}

/** 渲染 pm2 风格表格 */
export function renderStatusTable(rows: StatusRow[]): string {
  const cols = ["id", "name", "mode", "↺", "status", "cpu", "memory", "uptime"];
  const data = rows.map((r) => [
    String(r.id),
    r.name,
    r.mode,
    String(r.restarts),
    r.online ? "online" : "offline",
    r.online ? `${(r.cpuPct ?? 0).toFixed(1)}%` : "-",
    r.online ? fmtMemory(r.memBytes ?? 0) : "-",
    r.online ? fmtUptime(r.uptimeSec ?? 0) : "-",
  ]);
  const widths = cols.map((c, i) => Math.max(c.length, ...data.map((row) => row[i].length)));
  const line = (sep: string, left: string, mid: string, right: string) =>
    left + widths.map((w) => sep.repeat(w + 2)).join(mid) + right;
  const row = (cells: string[]) =>
    "│ " + cells.map((c, i) => c.padEnd(widths[i])).join(" │ ") + " │";
  return [
    line("─", "┌", "┬", "┐"),
    row(cols),
    line("─", "├", "┼", "┤"),
    ...data.map(row),
    line("─", "└", "┴", "┘"),
  ].join("\n");
}
