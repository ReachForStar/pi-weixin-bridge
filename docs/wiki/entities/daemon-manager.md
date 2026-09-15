---
title: 内置后台 daemon 管理器
type: entity
tags: [daemon, supervisor, 进程管理, 部署]
created: 2026-09-16
updated: 2026-09-16
sources: []
status: active
---

# 内置后台 daemon 管理器（src/daemon/）

零第三方依赖的后台常驻方案，替代 PM2 硬依赖（选型理由见 [决策页](../decisions/builtin-daemon-over-pm2.md)）。

## 职责

- **supervisor 进程**（`supervisor.ts`，`runSupervisor`）：常驻拉起桥接子进程（`node bin/pi-weixin-bridge.js start`），子进程崩溃则按指数退避重启（3s 起、×2、封顶 60s；存活超 60s 重置退避）；子进程干净退出（code 0）不重启；自带“重复 supervisor”自保护；bridge.log 超 5MB 滚动为 .1。
- **控制端**（`daemon.ts`）：`startDaemon`（detached + windowsHide 拉起 supervisor，stdio 重定向到 supervisor.log，等待 pid 文件落盘）、`stopDaemon`（杀进程树 + 清理 PID 文件）、`daemonStatus`、`tailLog`、`isPidAlive`、`nextBackoffMs`。
- **开机自启**（`boot.ts`，跨平台）：`installBootTask` / `uninstallBootTask`，任务名 `pi-weixin-bridge`。
  - Windows：经 `scripts/install-boot.ps1` / `uninstall-boot.ps1` 注册/移除**每用户登录**计划任务（免管理员、隐藏窗口）；有 `start-service.ps1` 时用它（git 安装路径稳定），否则回退 `cmd /c npx -y pi-weixin-bridge daemon start`。
  - Linux：systemd **用户服务**（`~/.config/systemd/user/pi-weixin-bridge.service`，`renderSystemdUnit` 纯函数生成，含空格路径自动加引号）；`Type=forking` + `PIDFile` 指向 supervisor.pid（`daemon start` 拉起 supervisor 后退出，systemd 经 PIDFile 接管）；`systemctl --user daemon-reload` 探测 systemd 可用性，不可用时优雅报错；uninstall 只 `disable` 不 `--now`（不动正在运行的服务）。

## 关键文件 / 接口

- `src/daemon/daemon.ts`：`DAEMON_DIR`（`~/.pi-weixin-bridge/daemon/`）、`SUPERVISOR_PID_FILE` / `BRIDGE_PID_FILE` / `BRIDGE_LOG_FILE` / `SUPERVISOR_LOG_FILE`、`startDaemon()`、`stopDaemon()`、`daemonStatus()`、`isPidAlive(pid)`、`nextBackoffMs(prev, uptime)`。
- `src/daemon/supervisor.ts`：`runSupervisor(opts)`，`opts` 支持 `childArgs` / `daemonDir` / `baseBackoffMs` / `shouldStop` / `onChildExit`（后三项为测试注入点）。子进程 env 强制 `PI_WEIXIN_HEADLESS=1`。
- `src/daemon/boot.ts`：`installBootTask()` / `uninstallBootTask()`，任务名 `pi-weixin-bridge`。
- CLI 入口：`src/cli.ts` 的 `runDaemon`（`daemon start/stop/status/restart/logs/install-boot/uninstall-boot/supervise`）。

## 上下游依赖

- 上游：CLI（`src/cli.ts`）、`start-service.ps1` / `stop-service.ps1`（快捷方式）、计划任务（开机自启）。
- 下游：桥接服务本体（`src/index.ts`，经 bin 包装器运行）；状态目录 `~/.pi-weixin-bridge/`（`account.json` 供 headless 重登轮询）。
- 平台差异：Windows 杀树用 `taskkill /t /f`；POSIX 用进程组 `kill(-pid, SIGTERM)`。

## 重要变更记录

- 2026-09-16（v1.5.0）：boot.ts 跨平台（Linux systemd 用户服务）；supervisor 退避等待改为可被信号打断。
- 2026-09-16（v1.4.0）：新建本模块；`install/stop/status/update/uninstall` 从 PM2 切换到内置 daemon；headless 重登（等待 `account.json` 更新）；开机自启计划任务。PM2 降级为可选路径。
