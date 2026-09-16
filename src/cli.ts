import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "./config.js";
import { IlinkClient } from "./ilink/client.js";
import { loginWithQR } from "./ilink/login.js";
import { loadState, saveState } from "./account.js";
import { runInstallWizard } from "./wizard.js";
import {
  BIN_PATH,
  BRIDGE_LOG_FILE,
  daemonStatus,
  startDaemon,
  stopDaemon,
  tailLog,
} from "./daemon/daemon.js";
import { installBootTask, uninstallBootTask } from "./daemon/boot.js";
import { runSupervisor } from "./daemon/supervisor.js";

// 包根目录（src 的上级），用于定位 ps1 脚本与计划任务
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHORTCUTS = ["start-pi-weixin-bridge.lnk", "stop-pi-weixin-bridge.lnk"];

function printHelp(): void {
  console.log(`pi-weixin-bridge — 微信 ClawBot ↔ pi 桥接服务

用法: pi-weixin-bridge <命令>

命令:
  install         一键安装：选择保存路径 + 扫码绑定微信 + 启动后台 daemon + 快捷方式（Windows）
  login           扫码登录 / 重新绑定微信
  start           前台运行桥接服务（默认命令）
  stop            停止后台 daemon
  status          查看后台 daemon 状态
  daemon          后台 daemon 管理（见 daemon help）
  update          更新到最新版（全局安装：npm i -g 拉 npm 最新；git 安装：pull+install；npx 提示重跑）
  uninstall       卸载：停止服务、移除自启与快捷方式（保留账号凭据）
  help            显示本帮助

选项:
  install --yes   非交互安装（全部使用默认路径，不询问）

示例:
  npx -y pi-weixin-bridge install
  npx -y pi-weixin-bridge login
  npx -y pi-weixin-bridge status
`);
}

function printDaemonHelp(): void {
  console.log(`pi-weixin-bridge daemon <子命令>

子命令:
  start            启动后台 daemon（崩溃自动重启；已运行则跳过）
  stop             停止 daemon（杀进程树并清理 PID 文件）
  status           查看运行状态与日志路径
  restart          重启 daemon
  logs [n]         查看桥接日志末尾 n 行（默认 50）
  install-boot     注册开机自启（Windows 计划任务 / Linux systemd 用户服务，免管理员）
  uninstall-boot   移除开机自启
  supervise        内部命令：supervisor 进程本体（由 daemon start 拉起，勿手动运行）

说明:
  - PID 与日志位于 ~/.pi-weixin-bridge/daemon/（或 PI_WEIXIN_STATE_DIR 下）
  - 后台模式下会话过期无法扫码：日志会提示在终端运行
    pi-weixin-bridge login 重新扫码，扫码完成后服务自动恢复
`);
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

/** 运行 create-shortcuts.ps1 生成隐藏窗口快捷方式（仅 Windows） */
function createShortcuts(): void {
  if (process.platform !== "win32") {
    console.log("（非 Windows 平台，跳过快捷方式；自启用 daemon install-boot）");
    return;
  }
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

async function runDaemon(args: string[]): Promise<void> {
  const sub = args[0] ?? "help";
  switch (sub) {
    case "start": {
      const r = startDaemon();
      console.log(r.message);
      if (!r.ok) process.exit(1);
      break;
    }
    case "stop": {
      const r = stopDaemon();
      console.log(r.stopped ? "已停止" : "服务未在运行");
      break;
    }
    case "status": {
      const st = daemonStatus();
      if (st.running) {
        console.log(
          `运行中：supervisor pid ${st.supervisorPid}${st.bridgePid ? `，桥接 pid ${st.bridgePid}` : "（桥接进程未就绪）"}`,
        );
      } else {
        console.log("未运行");
      }
      console.log(`桥接日志: ${BRIDGE_LOG_FILE}`);
      break;
    }
    case "restart": {
      stopDaemon();
      const r = startDaemon();
      console.log(r.message);
      if (!r.ok) process.exit(1);
      break;
    }
    case "logs": {
      const n = Math.max(1, Number.parseInt(args[1] ?? "50", 10) || 50);
      const tail = tailLog(BRIDGE_LOG_FILE, n);
      console.log(tail || "（暂无日志）");
      break;
    }
    case "install-boot": {
      const r = installBootTask();
      console.log(r.message);
      if (!r.ok) process.exit(1);
      break;
    }
    case "uninstall-boot": {
      const r = uninstallBootTask();
      console.log(r.message);
      break;
    }
    case "supervise": {
      // supervisor 进程本体：由 daemon start 以 detached 方式拉起
      await runSupervisor();
      break;
    }
    case "help":
    case "--help":
    case "-h":
      printDaemonHelp();
      break;
    default:
      console.error(`未知 daemon 子命令: ${sub}\n`);
      printDaemonHelp();
      process.exit(1);
  }
}

async function install(args: string[]): Promise<void> {
  const assumeYes = args.includes("--yes") || args.includes("-y");
  console.log("=== pi-weixin-bridge 安装 ===\n");

  // 第 1 步：选择保存路径（交互询问；结果写入 config.json，后续进程与 daemon 子进程均能读到）
  console.log("第 1 步：选择保存路径（账号凭据 / 会话上下文 / 后台日志 / 工作目录）");
  const choice = await runInstallWizard({ assumeYes });
  if (!choice.fromDefaults) {
    // 本进程的配置常量已在启动时解析完毕，用 env（优先级最高）重执行自身，
    // 保证后续登录/daemon 子进程都生效新路径
    const r = spawnSync(process.execPath, [BIN_PATH, "install", "--yes"], {
      stdio: "inherit",
      env: {
        ...process.env,
        PI_WEIXIN_STATE_DIR: choice.stateDir,
        PI_WEIXIN_WORKSPACE: choice.workspace,
      },
    });
    process.exit(r.status ?? 1);
  }
  console.log("");

  // 第 2 步：扫码绑定微信
  const state = loadState();
  if (state?.botToken) {
    console.log(`已存在登录账号 ${state.accountId}，跳过扫码（重新绑定请用 login 命令）。\n`);
  } else {
    console.log("第 2 步：扫码绑定微信");
    const ok = await login();
    if (!ok) {
      console.error("登录失败，安装中止。");
      process.exit(1);
    }
    console.log("");
  }

  // 第 3 步：后台 daemon（内置，零第三方依赖：崩溃自动重启 + 日志）
  console.log("第 3 步：启动后台 daemon");
  const d = startDaemon();
  console.log(d.message);
  if (!d.ok) {
    console.error("daemon 启动失败，安装中止。");
    process.exit(1);
  }
  console.log("");

  // 第 4 步：快捷方式（仅 Windows）
  console.log("第 4 步：创建快捷方式");
  createShortcuts();
  console.log("");

  console.log("✅ 安装完成。");
  console.log(`   - 状态目录: ${choice.stateDir}`);
  console.log(`   - pi 工作目录: ${choice.workspace}`);
  console.log("   - 服务已后台运行（pi-weixin-bridge status 查看）");
  console.log("   - 开机自启（可选）：pi-weixin-bridge daemon install-boot");
}

function uninstall(): void {
  console.log("=== 卸载 pi-weixin-bridge ===");
  const r = stopDaemon();
  console.log(r.stopped ? "已停止后台 daemon" : "daemon 未在运行");
  const boot = uninstallBootTask();
  console.log(boot.message);
  for (const name of SHORTCUTS) {
    const p = join(PKG_ROOT, name);
    if (existsSync(p)) rmSync(p);
  }
  console.log(`✅ 已停止服务、移除自启与快捷方式（账号凭据保留在 ~/.pi-weixin-bridge/account.json）`);
}

/** 更新到最新版：按安装方式分路——
 * 全局安装（npm i -g）：npm install -g pi-weixin-bridge@latest（npm registry）+ 重启 daemon；
 * git 安装（克隆仓库）：git pull + npm install + 重启；
 * npx 临时安装：提示重跑 npx -y pi-weixin-bridge install（npm registry，自动拉最新） */
function update(): void {
  console.log("=== 更新 pi-weixin-bridge ===\n");

  const restartDaemon = (): void => {
    console.log("\n重启服务加载新版本");
    stopDaemon();
    const r = startDaemon();
    console.log(r.message);
    console.log("\n✅ 更新完成。");
  };

  // 1) 全局安装（PKG_ROOT 位于 npm 全局目录）：从 npm registry 更新
  const globalRoot = spawnSync("npm", ["root", "-g"], { encoding: "utf8", shell: true }).stdout.trim();
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\\?\/$/, "").toLowerCase();
  if (globalRoot && norm(PKG_ROOT).startsWith(norm(globalRoot))) {
    console.log("当前为全局安装（npm i -g），从 npm registry 更新到最新版…");
    const r = spawnSync("npm", ["install", "-g", "pi-weixin-bridge@latest"], { stdio: "inherit", shell: true });
    if (r.status !== 0) {
      console.error("npm install -g 失败，更新中止。请检查网络/registry 后重试。");
      process.exit(1);
    }
    restartDaemon();
    return;
  }

  // 2) git 安装（克隆的仓库）：拉代码 + 装依赖 + 重启
  if (existsSync(join(PKG_ROOT, ".git"))) {
    console.log("第 1 步：拉取最新代码");
    const pull = spawnSync("git", ["pull"], { cwd: PKG_ROOT, stdio: "inherit", shell: true });
    if (pull.status !== 0) {
      console.error("git pull 失败，更新中止。");
      process.exit(1);
    }

    console.log("\n第 2 步：更新依赖");
    const install = spawnSync("npm", ["install"], { cwd: PKG_ROOT, stdio: "inherit", shell: true });
    if (install.status !== 0) console.error("npm install 失败，请手动检查。");

    restartDaemon();
    return;
  }

  // 3) npx 临时安装：npx 每次运行自动从 npm registry 拉最新版，重跑安装命令即可
  console.log("当前为 npx 临时安装，npx 每次运行自动从 npm 获取最新版，无需手动更新。");
  console.log("若后台服务还在跑旧版本，重新运行安装命令即可升级：");
  console.log("  npx -y pi-weixin-bridge install");
}

export async function runCli(args: string[]): Promise<void> {
  const command = args[0] ?? "help";
  switch (command) {
    case "install":
      await install(args.slice(1));
      break;
    case "login":
      await login();
      break;
    case "start":
      // bin 包装器已处理 start；这里兜底（直接调 runCli 的场景）
      await import("./index.js");
      break;
    case "stop":
      stopDaemon();
      break;
    case "status":
      await runDaemon(["status"]);
      break;
    case "daemon":
      await runDaemon(args.slice(1));
      break;
    case "uninstall":
      uninstall();
      break;
    case "update":
      update();
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
