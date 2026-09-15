---
title: 后台重登挂死与 daemon 落地排查
type: query
tags: [daemon, 后台, 重登, stdin, hang, 排查, 计划任务]
created: 2026-09-16
updated: 2026-09-16
sources: []
status: active
---

# 后台重登挂死与 daemon 落地排查

## 问题

用户反馈：项目“无法挂后台运行，即使有 PM2 也不行”。表现为：前台 `npm start` 扫码后一切正常；一旦用 PM2 / 隐藏窗口后台拉起，运行一段时间后（微信会话过期）就收不到消息，且 PM2 里进程显示“活着”。

## 根因

1. **headless 重登挂死（主因）**：`src/index.ts` 的 `main()` 在捕获到 `SessionTimeoutError` / `AuthError` 时调用 `doLogin()` → `loginWithQR()`。后者把二维码写 stdout，并用 `readLine(process.stdin)`（`rl.question()`）等待用户输入配对码。
   - 后台下 stdin 无输入，`rl.question()` 的 Promise **永不 resolve**，主循环被永久卡住 → 不再 `getUpdates`，但进程不退出。
   - 二维码打到 `logs/out.log`，用户在后台看不到；即使看到也无法把配对码喂进 PM2 的 stdin。
   - 结论：这是代码的后台行为缺陷，**不是 PM2 的问题**。换任何“只看进程死活”的守护（pm2 / systemd / 计划任务）都救不了这种挂起。
2. **次要**：PM2 守护进程不随开机自启；`logs/`、PID 相对包目录（npx 临时目录会被清理）；`max_restarts: 10`。

## 解法

1. **headless 重登**（`src/index.ts` + `src/account.ts`）：
   - 判定后台模式：`PI_WEIXIN_HEADLESS === "1"` 或 `!process.stdout.isTTY`。
   - 后台模式下会话过期/无账号时，不再 `readLine(stdin)`，改为 `waitForAccountChange(prev, signal)`：轮询 `account.json`，直到出现与 `prev` 不同的 `botToken`；进程被 abort 时抛错避免挂起。
   - 用户在任意终端跑 `pi-weixin-bridge login` 扫码 → `saveState` 写新 token → 后台进程检测到后自动 `client.setToken/setBaseUrl` 并恢复消息循环，无需重启服务。
2. **内置 daemon**（`src/daemon/`）：见 [决策：后台常驻采用内置 daemon 而非 PM2](../decisions/builtin-daemon-over-pm2.md)。supervisor 崩溃重启 + 指数退避；控制端 start/stop/status/restart/logs；开机自启用每用户登录计划任务。

## 涉及模块

- `src/index.ts`（main 循环、headless 判定、waitForHeadlessLogin）
- `src/account.ts`（waitForAccountChange）
- `src/daemon/`（daemon.ts / supervisor.ts / boot.ts）
- `src/cli.ts`（daemon 子命令、install/stop/status/update/uninstall 切换）
- `scripts/install-boot.ps1`、`uninstall-boot.ps1`、`start-service.ps1`、`stop-service.ps1`

## 复发预防 / 踩坑备忘

- **任何“需要 stdin 交互”的登录流程都不能默认在后台路径上调用**：判定 TTY / 显式 headless 标志，后台改为“等待外部更新凭据文件”模式。
- **Windows 计划任务免管理员**：`New-ScheduledTaskTrigger -AtLogOn` 必须显式 `-User "$env:USERDOMAIN\$env:USERNAME"`，否则按“任何用户登录”注册会报 0x80070005（PermissionDenied）。这是本次实测踩到的坑。
- **杀进程树**：Windows 用 `taskkill /pid <supervisor> /t /f`；POSIX 上 supervisor 以 `detached: true` 拉起成为进程组组长，`process.kill(-pid, SIGTERM)` 整组杀。
- **PID 存活判定**：`process.kill(pid, 0)` 不发信号只查存在性；Windows 上返回 `EPERM` 表示进程存在但无权发信号，应视为存活。
- **e2e 验证**：无真实微信账号时，写入伪造 `account.json` 即可驱动“检测到新账号→恢复→token 被服务端拒→回到等待”的完整闭环；验证后务必删除伪造账号文件。
