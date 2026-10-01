import { describe, it, expect } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createShortcuts } from "../src/cli.js";
import { runWindowsHelper } from "../src/platform.js";

describe.skipIf(process.platform !== "win32")("真实 Windows 系统接口", () => {
  function directory(): string {
    mkdirSync("tmp", { recursive: true });
    return mkdtempSync(resolve("tmp", "Author Software 中文 🚀 shortcuts "));
  }
  function helper(root: string): string {
    mkdirSync(join(root, "scripts"));
    const file = join(root, "scripts", "windows-helper.js");
    copyFileSync("scripts/windows-helper.js", file);
    mkdirSync(join(root, "scripts", "templates"));
    copyFileSync("scripts/templates/node-launcher.lnk", join(root, "scripts", "templates", "node-launcher.lnk"));
    return file;
  }
  it("带空格与中文目录实际生成快捷方式并通过 COM 读取", () => {
    const root = directory();
    const script = helper(root);
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "bin", "pi-weixin-bridge.js"), 'import { writeFileSync } from "node:fs"; writeFileSync("invocation.json", JSON.stringify(process.argv.slice(2))); process.exit(7);', "utf8");
    createShortcuts(root);
    for (const mode of ["start", "stop"]) {
      const file = join(root, mode + "-pi-weixin-bridge.lnk");
      expect(existsSync(file)).toBe(true);
      const [target, args, working, style] = runWindowsHelper(["inspect-shortcut", file], script).split(/\r?\n/);
      expect(target.toLowerCase()).toBe(process.execPath.toLowerCase());
      expect(args).toBe('"' + mode + '-pi-weixin-bridge.cjs"');
      expect(working.toLowerCase()).toBe(root.toLowerCase());
      expect(Number(style)).toBe(7);
      const result = spawnSync(target, [mode + "-pi-weixin-bridge.cjs"], { cwd: working, encoding: "utf8", timeout: 60_000, windowsHide: true });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(7);
      expect(JSON.parse(readFileSync(join(root, "invocation.json"), "utf8"))).toEqual(["daemon", mode]);
    }
  }, 100_000);
  it("缺少实际入口时传播系统接口失败", () => {
    const root = directory();
    helper(root);
    expect(() => createShortcuts(root)).toThrow("Windows 系统工具执行失败");
    expect(existsSync(join(root, "start-pi-weixin-bridge.lnk"))).toBe(false);
  }, 35_000);
  it("缺少打包脚本立即报错", () => {
    expect(() => createShortcuts(directory())).toThrow("缺少 windows-helper.js");
  });
  it("真实 COM 生成登录任务定义但不注册系统任务", () => {
    const root = directory();
    const script = helper(root);
    const xml = runWindowsHelper(["task-preview", process.execPath, resolve("bin/pi-weixin-bridge.js"), "start", root, root, "provider/model", root], script);
    const require = createRequire(resolve("node_modules/@earendil-works/pi-coding-agent/package.json"));
    const { XMLParser } = require("fast-xml-parser");
    const task = new XMLParser().parse(xml).Task;
    expect(task.Triggers.LogonTrigger.UserId).toBeTruthy();
    expect(task.Principals.Principal.LogonType).toBe("InteractiveToken");
    expect(task.Actions.Exec.Command.toLowerCase()).toBe(process.execPath.toLowerCase());
    expect(task.Actions.Exec.Arguments).toContain('"' + root + '"');
    expect(task.Actions.Exec.Arguments).toContain('"provider/model"');
    expect(task.Settings.ExecutionTimeLimit).toBe("PT0S");
  }, 35_000);
  it("隐藏启动真实 Node 子进程并传递配置与失败退出码", () => {
    const root = directory();
    const script = helper(root);
    const entry = join(root, "inspect-env.cjs");
    const result = join(root, "environment.json");
    writeFileSync(entry, 'require("node:fs").writeFileSync(process.env.PI_WEIXIN_STATE_DIR + "/environment.json", JSON.stringify({ args: process.argv.slice(2), state: process.env.PI_WEIXIN_STATE_DIR, workspace: process.env.PI_WEIXIN_WORKSPACE, model: process.env.PI_WEIXIN_MODEL, agent: process.env.PI_CODING_AGENT_DIR })); process.exit(7);', "utf8");
    expect(() => runWindowsHelper(["run", process.execPath, entry, "start", root, root, "provider/model", root], script)).toThrow("退出码 7");
    expect(JSON.parse(readFileSync(result, "utf8"))).toEqual({ args: ["daemon", "start"], state: root, workspace: root, model: "provider/model", agent: root });
  }, 35_000);
});
