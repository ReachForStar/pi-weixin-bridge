---
title: 后台常驻采用内置 daemon 而非 PM2
type: decision
tags: [daemon, pm2, background, windows, 部署]
created: 2026-09-16
updated: 2026-09-16
sources: []
status: active
---

# 后台常驻采用内置 daemon 而非 PM2

## 背景（现状与约束）

本项目是一个长轮询收消息的桥接服务（微信 iLink → pi），需要 7×24 后台常驻。此前默认用 PM2 拉起，但在用户的真实机器上“挂后台运行不行，即使有 PM2 也不行”。排查发现根因不在 PM2 本身（PM2 守护进程、git-bash、Node 22 均正常），而在服务代码的后台行为：

- 会话过期（errcode -14）/鉴权失效时，`main()` 会调用 `loginWithQR()` 交互扫码：把二维码打到 stdout、再用 `readLine(process.stdin)` 等待配对码输入。
- 在后台（PM2 / 隐藏窗口）下 stdin 永远没有输入，`rl.question()` 的 Promise **永不 settle**，进程活着但彻底挂起、不再轮询消息。
- PM2 只监控进程“死/活”，看不出这种挂起，所以“pm2 也不行”。
- 次要问题：PM2 守护进程不随开机自启；`logs/`、PID 相对包目录（npx 临时安装会被清理）；`max_restarts: 10` 崩溃满 10 次后 PM2 放弃重启。

约束：用户环境是 Windows（RDP 会话），无管理员权限；npx 临时安装路径不稳定；服务需复用用户 `~/.pi/agent` 与 `~/.pi-weixin-bridge` 配置。

## 备选方案（各方案优劣）

- **保留 PM2**（修重登 + pm2-windows-startup）：改动小，但 Windows 官方支持弱，需额外保活 pm2 守护进程，多一层依赖；重登挂死问题仍要单独修。
- **内置 daemon 管理器（零第三方依赖）**：自写 supervisor（崩溃重启 + 指数退避）+ 控制端（start/stop/status/logs）+ 计划任务（开机自启）。PID/日志落在 `~/.pi-weixin-bridge/daemon/`，npx 临时目录被清理也不受影响；免管理员；跨平台。代价：需自行维护一段进程管理代码。
- **只用计划任务、无 supervisor**：最省代码，但进程崩溃后不会自动重启（任务“重启失败”策略很粗糙）。
- **正式 Windows 服务（node-windows / NSSM）**：需管理员，且服务默认跑在 LocalSystem / session 0，读不到用户目录下的 `~/.pi/agent` 与账号文件，需为服务单独配置用户账号 + 密码，与“复用用户配置”的设计冲突。
- **Docker**：不可行——扫码登录与 pi 配置都在本机用户环境。

## 决策（选定方案）

采用**内置 daemon 管理器**作为默认后台路径（`src/daemon/`），PM2 降级为可选路径（`npm run pm2:*` 仍可用）。同时修复后台重登：后台（headless）模式下会话过期不再交互扫码，而是等待终端 `login` 更新 `account.json`，检测到新 botToken 后自动恢复。

## 理由（决策依据）

- 直接命中“pm2 也不行”的根因（headless 重登挂死），这是任何后台方案都必须修的。
- 零第三方依赖：不引入 pm2 守护进程 / git-bash / 管理员权限等额外约束，与项目“单用户、复用本机配置”的定位一致。
- 状态落 `~/.pi-weixin-bridge/`（而非包目录），npx 临时安装被清理也不影响 PID/日志。
- 开机自启用**每用户登录计划任务**（免管理员），规避 Windows 服务的用户上下文问题。

## 后果（影响与后续）

- 新增 `src/daemon/`（daemon.ts / supervisor.ts / boot.ts）与 `scripts/install-boot.ps1`、`uninstall-boot.ps1`；`start/stop-service.ps1` 改调 `daemon start/stop`。
- CLI 新增 `daemon start/stop/status/restart/logs/install-boot/uninstall-boot/supervise`；`install/stop/status/update/uninstall` 从 PM2 切到内置 daemon。
- 已知坑：`New-ScheduledTaskTrigger -AtLogOn` 若**不显式指定 `-User`**，任务按“任何用户登录”注册，会触发 0x80070005 权限拒绝；必须 `-User "$env:USERDOMAIN\$env:USERNAME"` 才是每用户免管理员任务（见 [后台重登挂死与 daemon 落地](../queries/background-relogin-hang.md)）。
- 后续：daemon 无日志上限清理（仅 5MB 轮转覆盖）；如需多实例 / 集群监控可再评估。
