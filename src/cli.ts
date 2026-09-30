import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "./config.js";
import { IlinkClient } from "./ilink/client.js";
import { loginWithQR } from "./ilink/login.js";
import { loadState, saveState } from "./account.js";
import { runInstallWizard, runModelWizard } from "./wizard.js";
import {
  BIN_PATH,
  BRIDGE_LOG_FILE,
  daemonStatus,
  readRestartCount,
  readRuntimeStatus,
  startDaemon,
  stopDaemon,
  tailLog,
} from "./daemon/daemon.js";
import { installBootTask, uninstallBootTask } from "./daemon/boot.js";
import { runSupervisor } from "./daemon/supervisor.js";
import { procStats, renderStatusTable, type StatusRow } from "./daemon/procs.js";

// 包根目录（src 的上级），用于定位 ps1 脚本与计划任务
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHORTCUTS = ["start-pi-weixin-bridge.lnk", "stop-pi-weixin-bridge.lnk"];

function printHelp(): void {
  console.log(`pi-weixin-bridge — 微信 ClawBot ↔ pi 桥接服务

用法: pi-weixin-bridge <命令>

命令:
  install         选择路径 → 扫码绑定 → 选择供应方和默认模型 → 启动后台 → Windows 快捷方式
  login           扫码登录 / 重新绑定微信
  start           前台运行桥接服务（默认命令）
  stop            停止后台 daemon
  status          查看后台 daemon 状态
  daemon          后台 daemon 管理（见 daemon help）
  update          从 npm 安装最新版本并重启后台（需已通过 npm 全局安装）
  uninstall       卸载：停止服务、移除自启与快捷方式（保留账号凭据）
  help            显示本帮助

选项:
  install --yes   跳过路径和模型询问；仍需扫码（没有已保存账号时）
                  必须已有默认模型，或用 PI_WEIXIN_MODEL 指定 models.json 中的模型

模型配置:
  供应方和模型读取 pi 的 models.json，默认位置 ~/.pi/agent/models.json
  PI_CODING_AGENT_DIR 可指定 pi 配置目录，鉴权沿用 pi 配置
  扫码后按供应方编号和模型编号选择，默认模型保存到 ~/.pi-weixin-bridge/config.json
  PI_WEIXIN_MODEL=供应方/模型编号 优先于保存的默认模型
  微信发送 /model 查看当前模型，/model list 查看编号，/model <编号或供应方/模型> 切换
  微信切换仅影响当前会话，重启后保留；/reload 重新读取模型配置

微信命令:
  /help /status /ping                 帮助、状态、存活检查
  /new /sessions /resume /rename /export  新建、历史、切换、命名、导出会话
  /tasks /cancel /stop /history /result /retry  当前任务、取消、停止、记录、结果、重试
  /files /files find /file /ocr        资料列表、检索、取回、扫描文档转换
  /project /skill /mcp                项目、技能、MCP
  /schedule /approve /reject          定时任务、操作确认、拒绝
  /usage /daily /doctor               会话用量、日用量、本地诊断
  完整参数与权限说明在微信 /help 和项目 README 中

路径与后台:
  PI_WEIXIN_STATE_DIR 指定状态目录；PI_WEIXIN_WORKSPACE 指定默认工作目录
  配置文件固定为 ~/.pi-weixin-bridge/config.json，环境变量优先
  start 在前台运行；daemon start 在后台运行；daemon logs 查看错误和登录提示

示例:
  npm install -g pi-weixin-bridge
  pi-weixin-bridge install
  pi-weixin-bridge login
  pi-weixin-bridge status
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
  - 自启依赖当前包和 Node 路径存在；请通过 npm 全局安装
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
      const r = await startDaemon();
      console.log(r.message);
      if (!r.ok) process.exit(1);
      break;
    }
    case "stop": {
      const r = await stopDaemon();
      console.log(r.stopped ? "已停止" : "服务未在运行");
      break;
    }
    case "status": {
      await printDaemonStatus();
      break;
    }
    case "restart": {
      await stopDaemon();
      const r = await startDaemon();
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
  const choice = args.includes("--paths-configured")
    ? { stateDir: (await import("./config.js")).STATE_DIR, workspace: (await import("./config.js")).WORKSPACE, fromDefaults: true }
    : await runInstallWizard({ assumeYes });
  if (!choice.fromDefaults) {
    // 本进程的配置常量已在启动时解析完毕，用 env（优先级最高）重执行自身，
    // 保证后续登录/daemon 子进程都生效新路径
    const r = spawnSync(process.execPath, [BIN_PATH, "install", "--paths-configured", ...args], {
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

  console.log("第 3 步：选择 models.json 中的供应方和默认模型");
  await runModelWizard({ assumeYes });
  console.log("第 4 步：启动后台 daemon");
  const d = await startDaemon();
  console.log(d.message);
  if (!d.ok) {
    console.error("daemon 启动失败，安装中止。");
    process.exit(1);
  }
  console.log("");

  // 第 4 步：快捷方式（仅 Windows）
  console.log("第 5 步：创建快捷方式");
  createShortcuts();
  console.log("");

  console.log("✅ 安装完成。");
  console.log(`   - 状态目录: ${choice.stateDir}`);
  console.log(`   - pi 工作目录: ${choice.workspace}`);
  console.log("   - 服务已后台运行（pi-weixin-bridge status 查看）");
  console.log("   - 开机自启（可选）：pi-weixin-bridge daemon install-boot");
}

async function uninstall(): Promise<void> {
  console.log("=== 卸载 pi-weixin-bridge ===");
  const r = await stopDaemon();
  console.log(r.stopped ? "已停止后台 daemon" : "daemon 未在运行");
  const boot = uninstallBootTask();
  console.log(boot.message);
  for (const name of SHORTCUTS) {
    const p = join(PKG_ROOT, name);
    if (existsSync(p)) rmSync(p);
  }
  console.log(`✅ 已停止服务、移除自启与快捷方式（账号凭据保留在 ~/.pi-weixin-bridge/account.json）`);
}

/** 使用 npm 分发版本，更新前停止后台以避免正在运行的源码被替换。 */
async function update(): Promise<void> {
  const rootResult = spawnSync("npm", ["root", "-g"], { encoding: "utf8", shell: process.platform === "win32", timeout: 30_000 });
  if (rootResult.error || rootResult.status !== 0) throw new Error("无法获取 npm 全局安装目录，请检查 npm 是否可用");
  const globalRoot = rootResult.stdout.trim();
  const norm = (path: string) => path.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  if (!globalRoot || !norm(PKG_ROOT).startsWith(norm(globalRoot) + "/")) {
    throw new Error("请先运行 npm install -g pi-weixin-bridge，再使用全局命令 update");
  }
  console.log("停止后台并从 npm 更新到最新版");
  await stopDaemon();
  const result = spawnSync("npm", ["install", "-g", "pi-weixin-bridge@latest"], {
    stdio: "inherit", shell: process.platform === "win32", timeout: 300_000, windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error("npm 更新失败，后台保持停止；修复安装后运行 daemon start");
  const started = await startDaemon();
  console.log(started.message);
  if (!started.ok) throw new Error("npm 更新已完成，但后台尚未就绪，请检查 daemon logs");
  console.log("更新完成。");
}

/** 构建 daemon 状态表格（两行：supervisor + 桥接） */
async function buildStatusRows(): Promise<StatusRow[]> {
  const st = daemonStatus();
  const restarts = readRestartCount();
  const [sup, bridge] = await Promise.all([
    st.supervisorPid ? procStats(st.supervisorPid) : Promise.resolve(null),
    st.bridgePid ? procStats(st.bridgePid) : Promise.resolve(null),
  ]);
  return [
    {
      id: 0,
      name: "pi-weixin-supervisor",
      mode: "fork",
      restarts,
      online: st.running,
      pid: st.supervisorPid,
      ...(sup ?? {}),
    },
    {
      id: 1,
      name: "pi-weixin-bridge",
      mode: "fork",
      restarts,
      online: st.running && st.bridgePid !== undefined,
      pid: st.bridgePid,
      ...(bridge ?? {}),
    },
  ];
}

/** pm2 list 风格的 status 输出：表格 + pid + 日志路径 */
export async function printDaemonStatus(): Promise<void> {
  const rows = await buildStatusRows();
  console.log(renderStatusTable(rows));
  const st = daemonStatus();
  if (st.running) {
    console.log(
      `\nsupervisor pid ${st.supervisorPid}${st.bridgePid ? `，桥接 pid ${st.bridgePid}` : "（桥接进程未就绪）"}`,
    );
  } else {
    console.log("\n未运行（pi-weixin-bridge daemon start 启动）");
  }
  console.log(`桥接日志: ${BRIDGE_LOG_FILE}`);
  const runtime = readRuntimeStatus();
  const labels: Record<string, string> = { running: "消息循环已启动", "waiting-login": "等待扫码登录", initializing: "初始化中", stopped: "已退出" };
  console.log(`桥接状态: ${runtime && runtime.pid === st.bridgePid ? labels[runtime.state] ?? runtime.state : st.running ? "启动或重启中" : "未运行"}`);
}

export async function runCli(args: string[]): Promise<void> {
  const command = args[0] ?? "help";
  if (args.slice(1).some((argument) => argument === "--help" || argument === "-h")) {
    if (command === "daemon") printDaemonHelp();
    else printHelp();
    return;
  }
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
      await stopDaemon();
      break;
    case "status":
      await runDaemon(["status"]);
      break;
    case "daemon":
      await runDaemon(args.slice(1));
      break;
    case "uninstall":
      await uninstall();
      break;
    case "update":
      await update();
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
