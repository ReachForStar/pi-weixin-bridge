import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  isPidAlive,
  nextBackoffMs,
  readRestartCount,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
} from "../src/daemon/daemon.js";
import { runSupervisor } from "../src/daemon/supervisor.js";
import { parseEtime, fmtMemory, fmtUptime, renderStatusTable } from "../src/daemon/procs.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("daemon 退避策略", () => {
  it("崩溃循环时指数退避并设上限", () => {
    expect(nextBackoffMs(BASE_BACKOFF_MS, 1_000)).toBe(BASE_BACKOFF_MS * 2);
    expect(nextBackoffMs(BASE_BACKOFF_MS * 2, 1_000)).toBe(BASE_BACKOFF_MS * 4);
    expect(nextBackoffMs(MAX_BACKOFF_MS, 1_000)).toBe(MAX_BACKOFF_MS); // 封顶
  });

  it("子进程存活超过 60s 说明不是崩溃循环，退避重置", () => {
    expect(nextBackoffMs(MAX_BACKOFF_MS, 120_000)).toBe(BASE_BACKOFF_MS);
  });
});

describe("isPidAlive", () => {
  it("正确判断存活与退出", async () => {
    expect(isPidAlive(process.pid)).toBe(true);
    const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},300)"], {
      stdio: "ignore",
    });
    await new Promise<void>((res) => child.on("spawn", () => res()));
    expect(isPidAlive(child.pid!)).toBe(true);
    await new Promise<void>((res) => child.on("exit", () => res()));
    // node 已回收子进程，留一点余量避免个别平台的竞态
    await sleep(100);
    expect(isPidAlive(child.pid!)).toBe(false);
  });
});

describe("runSupervisor 重启循环", () => {
  it("崩溃（code!=0）后自动重启，shouldStop 后清理 pid 文件", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sup-restart-"));
    let stop = false;
    let exits = 0;
    const p = runSupervisor({
      childArgs: ["-e", "process.exit(1)"],
      daemonDir: dir,
      baseBackoffMs: 20,
      shouldStop: () => stop,
      onChildExit: () => {
        exits += 1;
        if (exits >= 2) stop = true;
      },
    });
    await p;
    expect(exits).toBeGreaterThanOrEqual(2);
    expect(existsSync(join(dir, "supervisor.pid"))).toBe(false);
    expect(existsSync(join(dir, "bridge.pid"))).toBe(false);
    expect(readRestartCount(dir)).toBe(1); // 崩溃一次后重启，计数落盘
    rmSync(dir, { recursive: true, force: true });
  });

  it("重启计数：每次 supervisor 启动归零", async () => {
    const dir = join(tmpdir(), "sup-count-reset-");
    rmSync(dir, { recursive: true, force: true });
    let stop = true; // 立即停止（干净退出）
    await runSupervisor({ childArgs: ["-e", "process.exit(0)"], daemonDir: dir, shouldStop: () => stop });
    expect(readRestartCount(dir)).toBe(0); // 全新启动归零
    rmSync(dir, { recursive: true, force: true });
  });

  it("子进程正常退出（code=0）时不再重启", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sup-clean-"));
    let stop = false;
    let exits = 0;
    const p = runSupervisor({
      childArgs: ["-e", "process.exit(0)"],
      daemonDir: dir,
      baseBackoffMs: 20,
      shouldStop: () => stop,
      onChildExit: () => {
        exits += 1;
      },
    });
    await p;
    expect(exits).toBe(1); // 只启动一次即停止
    expect(existsSync(join(dir, "supervisor.pid"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("运行期间写入 bridge.pid，退出后移除", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sup-pid-"));
    let stop = false;
    const bridgePidFile = join(dir, "bridge.pid");
    const p = runSupervisor({
      childArgs: ["-e", "setTimeout(()=>process.exit(1),120)"],
      daemonDir: dir,
      baseBackoffMs: 20,
      shouldStop: () => stop,
      onChildExit: () => {
        stop = true;
      },
    });
    // 等待子进程启动并写入 bridge.pid
    let sawBridgePid = false;
    for (let i = 0; i < 50 && !sawBridgePid; i++) {
      if (existsSync(bridgePidFile)) sawBridgePid = true;
      else await sleep(10);
    }
    expect(sawBridgePid).toBe(true);
    await p;
    expect(existsSync(bridgePidFile)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("status 表格渲染", () => {
  it("parseEtime / 格式化工具", () => {
    expect(parseEtime("05:23")).toBe(323);
    expect(parseEtime("01:02:03")).toBe(3723);
    expect(parseEtime("2-03:04:05")).toBe(2 * 86400 + 3 * 3600 + 4 * 60 + 5);
    expect(Number.isNaN(parseEtime("bad"))).toBe(true);
    expect(fmtMemory(120.5 * 1024 * 1024)).toBe("120.5mb");
    expect(fmtUptime(45)).toBe("45s");
    expect(fmtUptime(3000)).toBe("50m 0s");
    expect(fmtUptime(7325)).toBe("2h 2m");
  });

  it("renderStatusTable：online / offline 行与边框对齐", () => {
    const table = renderStatusTable([
      { id: 0, name: "pi-weixin-supervisor", mode: "fork", restarts: 3, online: true, cpuPct: 1.2, memBytes: 70 * 1024 * 1024, uptimeSec: 3725 },
      { id: 1, name: "pi-weixin-bridge", mode: "fork", restarts: 3, online: false },
    ]);
    expect(table).toContain("┌");
    expect(table).toContain("└");
    const header = table.split("\n")[1];
    for (const c of ["id", "name", "mode", "↺", "status", "cpu", "memory", "uptime"]) {
      expect(header).toContain(c);
    }
    expect(table).toContain("pi-weixin-supervisor");
    expect(table).toContain("online");
    expect(table).toContain("offline");
    expect(table).toContain("1.2%");
    expect(table).toContain("70.0mb");
    expect(table).toContain("1h 2m");
    // 各列对齐：每行字符数一致
    const lines = table.split("\n");
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
  });
});
