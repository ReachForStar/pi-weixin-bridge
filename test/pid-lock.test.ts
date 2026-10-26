import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { captureStartTime, matchesStartTime, parsePidFile } from "../src/daemon/pid-identity.js";
import { acquireProcessLock, pidIsOurs, readPidStamp, readProcessId } from "../src/daemon/process-lock.js";
import { writeFileAtomic } from "../src/fs-atomic.js";
import { readJson, saveJson } from "../src/features/state.js";

// 临时目录放项目根 tmp/（既有测试同款约定），前缀归入 clean-tmp 清理范围
async function directory(): Promise<string> {
  return mkdtemp(resolve("tmp", "pidcheck-"));
}

describe("pid-identity 解析", () => {
  it("接受纯数字（systemd PIDFile 契约）", () => {
    expect(parsePidFile("12345")).toEqual({ pid: 12345, startTime: undefined });
    expect(parsePidFile("  12345\n")).toEqual({ pid: 12345, startTime: undefined });
  });

  it("兼容历史 <pid>:<startTime> 格式", () => {
    expect(parsePidFile("12345:98765")).toEqual({ pid: 12345, startTime: "98765" });
    // macOS lstart 含空格与冒号
    expect(parsePidFile("12345:Mon Oct 26 10:00:00 2026")).toEqual({
      pid: 12345, startTime: "Mon Oct 26 10:00:00 2026",
    });
  });

  it("拒绝非法内容", () => {
    for (const text of ["", "0", "-1", "abc", "12.5", "123abc"]) {
      expect(parsePidFile(text)).toBeUndefined();
    }
  });

  it("同进程启动时间稳定，可识别 PID 复用", () => {
    const first = captureStartTime(process.pid);
    if (first === undefined) return; // 平台不支持时跳过
    expect(captureStartTime(process.pid)).toBe(first);
    expect(matchesStartTime(process.pid, first)).toBe("match");
    expect(matchesStartTime(process.pid, "999999")).toBe("mismatch");
    expect(matchesStartTime(process.pid, undefined)).toBe("unknown");
  });
});

describe("进程锁", () => {
  it("写入纯数字 pid，启动时间放旁路文件", async () => {
    const file = join(await directory(), "instance.pid");
    const release = acquireProcessLock(file);
    const raw = await readFile(file, "utf8");
    // 主文件必须是纯数字：systemd 的 parse_pid 只接受十进制
    expect(raw).toMatch(/^\d+$/);
    expect(Number(raw)).toBe(process.pid);
    if (captureStartTime(process.pid) !== undefined) {
      expect(readPidStamp(file)?.startTime).toBeDefined();
    }
    release();
  });

  it("拒绝重复获取", async () => {
    const file = join(await directory(), "dup.pid");
    const release = acquireProcessLock(file);
    expect(() => acquireProcessLock(file)).toThrow("已有进程运行");
    release();
  });

  it("非法内容按无锁处理且不抛错", async () => {
    const dir = await directory();
    const file = join(dir, "broken.pid");
    for (const content of ["", "0", "garbage"]) {
      await writeFile(file, content, "utf8");
      expect(readProcessId(file)).toBeNull();
    }
    const release = acquireProcessLock(file);
    expect(readProcessId(file)).toBe(process.pid);
    release();
  });

  it("回收被强杀进程留下的 .reclaim 残留", async () => {
    const dir = await directory();
    const file = join(dir, "stale.pid");
    await writeFile(file, "999999", "utf8");
    await writeFile(`${file}.reclaim`, "999998", "utf8");
    const release = acquireProcessLock(file);
    expect(readProcessId(file)).toBe(process.pid);
    expect(existsSync(`${file}.reclaim`)).toBe(false);
    release();
  });

  it("存活进程的锁不被回收", async () => {
    const file = join(await directory(), "alive.pid");
    await writeFile(file, String(process.pid), "utf8");
    expect(pidIsOurs(process.pid)).toBe(true);
    expect(() => acquireProcessLock(file)).toThrow("已有进程运行");
  });
});

describe("原子写", () => {
  it("写入内容完整且不残留临时文件", async () => {
    const dir = await directory();
    const file = join(dir, "state.json");
    writeFileAtomic(file, JSON.stringify({ a: 1 }));
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ a: 1 });
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("覆盖已有文件时不留下中间状态", async () => {
    const dir = await directory();
    const file = join(dir, "over.json");
    writeFileAtomic(file, "first");
    writeFileAtomic(file, "second");
    expect(await readFile(file, "utf8")).toBe("second");
  });
});

describe("状态文件结构校验", () => {
  it("语法合法但结构不符时隔离并回退空值", async () => {
    const dir = await directory();
    const file = join(dir, "tasks.json");
    for (const bad of ["null", "{}", "\"text\"", "123"]) {
      await writeFile(file, bad, "utf8");
      const result = readJson(file, [], (value): value is unknown[] => Array.isArray(value));
      expect(result).toEqual([]);
      const names = await readdir(dir);
      expect(names.some((name) => name.includes(".corrupt-"))).toBe(true);
    }
  });

  it("合法结构正常返回", async () => {
    const dir = await directory();
    const file = join(dir, "good.json");
    saveJson(file, [{ id: "a" }]);
    expect(readJson(file, [], (value): value is unknown[] => Array.isArray(value))).toEqual([{ id: "a" }]);
  });

  it("文件不存在返回空值", async () => {
    const dir = await directory();
    await mkdir(dir, { recursive: true });
    expect(readJson(join(dir, "missing.json"), [])).toEqual([]);
  });
});
