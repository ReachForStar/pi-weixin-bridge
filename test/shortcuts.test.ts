import { describe, it, expect } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createShortcuts } from "../src/cli.js";

describe.skipIf(process.platform !== "win32")("真实 Windows 快捷方式", () => {
  function directory(): string {
    mkdirSync("tmp", { recursive: true });
    return mkdtempSync(resolve("tmp", "Author Software shortcuts "));
  }

  it("带空格目录中实际生成快捷方式并通过 COM 读取参数", () => {
    const root = directory();
    for (const file of ["create-shortcuts.ps1", "start-service.ps1", "stop-service.ps1"]) copyFileSync(file, join(root, file));
    createShortcuts(root);
    for (const file of ["start-pi-weixin-bridge.lnk", "stop-pi-weixin-bridge.lnk"]) expect(existsSync(join(root, file))).toBe(true);
    const inspect = join(root, "inspect-shortcuts.ps1");
    writeFileSync(inspect, `$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$items = @('start-pi-weixin-bridge.lnk', 'stop-pi-weixin-bridge.lnk') | ForEach-Object {
    $shortcut = $shell.CreateShortcut((Join-Path $PSScriptRoot $_))
    @{ target = $shortcut.TargetPath; arguments = $shortcut.Arguments; directory = $shortcut.WorkingDirectory }
}
ConvertTo-Json -InputObject $items -Compress
`, "utf8");
    const powershell = join(process.env.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", inspect], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
    expect(result.status, result.stderr).toBe(0);
    const shortcuts = JSON.parse(result.stdout);
    for (const [index, file] of ["start-service.ps1", "stop-service.ps1"].entries()) {
      expect(shortcuts[index].arguments).toContain(`-File "${join(root, file)}"`);
      expect(shortcuts[index].directory.toLowerCase()).toBe(root.toLowerCase());
      expect(shortcuts[index].target.toLowerCase()).toBe(powershell.toLowerCase());
    }
  }, 30_000);

  it("缺少实际启动脚本时传播 PowerShell 失败，不吞掉异常", () => {
    const root = directory();
    copyFileSync("create-shortcuts.ps1", join(root, "create-shortcuts.ps1"));
    expect(() => createShortcuts(root)).toThrow("快捷方式创建失败");
    expect(existsSync(join(root, "start-pi-weixin-bridge.lnk"))).toBe(false);
  }, 30_000);

  it("缺少打包脚本立即报错", () => {
    expect(() => createShortcuts(directory())).toThrow("缺少 create-shortcuts.ps1");
  });
});
