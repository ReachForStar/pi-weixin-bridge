import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { procStats } from "../src/daemon/procs.js";
import { launchAgentConfig } from "../src/daemon/boot.js";
import { runWindowsHelper } from "../src/platform.js";
import { npmCommand } from "../src/npm-command.js";

describe("实际运行系统适配", () => {
  it("当前 Node 进程的真实 CPU、内存与运行时间可读取", async () => {
    const stats = await procStats(process.pid);
    expect(stats).not.toBeNull();
    expect(stats!.memBytes).toBeGreaterThan(0);
    expect(stats!.cpuPct).toBeGreaterThanOrEqual(0);
    expect(stats!.uptimeSec).toBeGreaterThanOrEqual(0);
    await expect(procStats(0)).rejects.toThrow("正整数");
  }, 65_000);
  it.skipIf(process.platform !== "win32")("Windows 直接通过 WMI 读取真实进程", () => {
    const values = runWindowsHelper(["stats", String(process.pid)]).split("\t").map(Number);
    expect(values).toHaveLength(3);
    expect(values.every(Number.isFinite)).toBe(true);
    expect(values[1]).toBeGreaterThan(0);
  }, 35_000);
  it("当前 Node 直接运行 npm JavaScript 入口", () => {
    const result = spawnSync(process.execPath, [npmCommand(), "--version"], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  }, 35_000);
  it("CI 执行器直接运行当前 npm，无需命令解释器", () => {
    mkdirSync("tmp", { recursive: true });
    const root = mkdtempSync(resolve("tmp", "CI runner "));
    const file = join(root, "command.json");
    writeFileSync(file, JSON.stringify({ npm: ["--version"] }), "utf8");
    const result = spawnSync(process.execPath, ["scripts/ci-run.mjs", file], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  }, 35_000);
  it("LaunchAgent 保留参数数组与带空格的实际工作目录", () => {
    mkdirSync("tmp", { recursive: true });
    const root = mkdtempSync(resolve("tmp", "Launch Agent "));
    const agent = launchAgentConfig(process.execPath, resolve("bin/pi-weixin-bridge.js"), root, root);
    expect(agent.ProgramArguments).toEqual([process.execPath, resolve("bin/pi-weixin-bridge.js"), "daemon", "supervise"]);
    expect(agent.RunAtLoad).toBe(true);
    expect(agent).not.toHaveProperty("KeepAlive");
    expect(agent.EnvironmentVariables).toMatchObject({ PI_WEIXIN_STATE_DIR: root, PI_WEIXIN_WORKSPACE: root });
  });
  it.skipIf(process.platform !== "darwin")("macOS plutil 实际转换 JSON 为 plist 并完整读回", () => {
    mkdirSync("tmp", { recursive: true });
    const root = mkdtempSync(resolve("tmp", "plist conversion "));
    const file = join(root, "agent.plist");
    const agent = launchAgentConfig(process.execPath, resolve("bin/pi-weixin-bridge.js"), root, root);
    const converted = spawnSync("/usr/bin/plutil", ["-convert", "xml1", "-o", file, "-"], { input: JSON.stringify(agent), encoding: "utf8", timeout: 8000 });
    expect(converted.status, converted.stderr).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("<plist");
    const inspected = spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8", timeout: 8000 });
    expect(inspected.status, inspected.stderr).toBe(0);
    expect(JSON.parse(inspected.stdout)).toEqual(agent);
  });
});
