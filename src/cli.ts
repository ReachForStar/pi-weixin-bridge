import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "./config.js";
import { IlinkClient } from "./ilink/client.js";
import { loginWithQR } from "./ilink/login.js";
import { loadState, saveState } from "./account.js";

// 包根目录（bin 的上级），用于定位 ecosystem.config.cjs 与快捷方式
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_NAME = "pi-weixin-bridge";
const SHORTCUTS = ["start-pi-weixin-bridge.lnk", "stop-pi-weixin-bridge.lnk"];

function printHelp(): void {
  console.log(`pi-weixin-bridge — 微信 ClawBot ↔ pi 桥接服务

用法: pi-weixin-bridge <命令>

命令:
  install     一键安装：扫码绑定微信 + 配置 PM2 常驻服务 + 创建快捷方式
  login       扫码登录 / 重新绑定微信
  start       前台运行桥接服务（默认命令）
  stop        停止 PM2 常驻服务
  status      查看 PM2 服务状态
  uninstall   卸载：删除 PM2 服务与快捷方式（保留账号凭据）
  help        显示本帮助

示例:
  npx -y pi-weixin-bridge install
  npx -y pi-weixin-bridge login
  npx -y pi-weixin-bridge status
`);
}

/** 在包根目录运行 npx pm2 <args>（继承 stdio 直接展示输出） */
function runPm2(args: string[]): number {
  const result = spawnSync("npx", ["pm2", ...args], {
    cwd: PKG_ROOT,
    stdio: "inherit",
    shell: true,
  });
  return result.status ?? 1;
}

/** 扫码登录并保存账号，返回是否成功 */
async function login(): Promise<boolean> {
  const client = new IlinkClient(CONFIG.fixedBaseUrl);
  try {
    const state = await loginWithQR(client);
    saveState(state);
    console.log(`\n✅ 登录成功：${state.accountId}`);
    return true;
  } catch (err) {
    console.error(`\n❌ 登录失败：${String(err)}`);
    return false;
  }
}

/** 运行 create-shortcuts.ps1 生成隐藏窗口快捷方式 */
function createShortcuts(): void {
  const script = join(PKG_ROOT, "create-shortcuts.ps1");
  if (!existsSync(script)) {
    console.log("（未找到 create-shortcuts.ps1，跳过快捷方式）");
    return;
  }
  spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
    cwd: PKG_ROOT,
    stdio: "inherit",
    shell: true,
  });
}

async function install(): Promise<void> {
  console.log("=== pi-weixin-bridge 安装 ===\n");

  // 第 1 步：扫码绑定微信
  const state = loadState();
  if (state?.botToken) {
    console.log(`已存在登录账号 ${state.accountId}，跳过扫码（重新绑定请用 login 命令）。\n`);
  } else {
    console.log("第 1 步：扫码绑定微信");
    const ok = await login();
    if (!ok) {
      console.error("登录失败，安装中止。");
      process.exit(1);
    }
    console.log("");
  }

  // 第 2 步：PM2 常驻服务
  console.log("第 2 步：配置 PM2 常驻服务");
  runPm2(["start", "ecosystem.config.cjs"]);
  runPm2(["save"]);
  console.log("");

  // 第 3 步：快捷方式
  console.log("第 3 步：创建快捷方式");
  createShortcuts();
  console.log("");

  console.log("✅ 安装完成。");
  console.log("   - 服务已后台运行（pi-weixin-bridge status 查看）");
  console.log("   - 快捷方式：start-pi-weixin-bridge.lnk / stop-pi-weixin-bridge.lnk");
}

function uninstall(): void {
  console.log("=== 卸载 pi-weixin-bridge ===");
  runPm2(["delete", APP_NAME]);
  for (const name of SHORTCUTS) {
    const p = join(PKG_ROOT, name);
    if (existsSync(p)) rmSync(p);
  }
  console.log("✅ 已删除 PM2 服务与快捷方式（账号凭据保留在 ~/.pi-weixin-bridge/account.json）");
}

export async function runCli(args: string[]): Promise<void> {
  const command = args[0] ?? "help";
  switch (command) {
    case "install":
      await install();
      break;
    case "login":
      await login();
      break;
    case "stop":
      runPm2(["stop", APP_NAME]);
      break;
    case "status":
      runPm2(["list"]);
      break;
    case "uninstall":
      uninstall();
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      console.error(`未知命令: ${command}\n`);
      printHelp();
      process.exit(1);
  }
}
