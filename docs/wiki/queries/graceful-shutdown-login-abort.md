---
title: 优雅停止与可中断登录
type: query
tags: [退出, 守护进程, 登录, 信号]
created: 2026-11-09
updated: 2026-11-09
status: active
---

## 问题

服务停止时存在两条不可控路径：

1. `daemon stop` 向 supervisor 发 SIGTERM 后，supervisor 内的停止检测立即对桥接子进程执行强杀（`killProcessTree(child.pid)` 默认 `force=true`）。桥接来不及中止模型请求、发送「任务已中断」通知、释放实例锁和清理 PID 旁路文件。
2. 前台运行或 `login` 过程中，扫码登录不接收退出信号。Ctrl+C 只触发桥接的 AbortController，登录仍卡在最长 35 秒的状态轮询或配对码输入上，用户会认为进程失去响应。

## 根因

- supervisor 的停止分支只调用一次 `killProcessTree`，没有「先温和、宽限期后升级」的阶段；daemon 侧虽有 SIGTERM 等待，但被 supervisor 的强杀抢先。
- 登录链路（`fetchQRCode`、`pollQRStatus`、`readLine`、轮询间隔）没有 signal 参数。`pollQRStatus` 还会吞掉所有异常并返回 `wait`，即使传入信号也无法向上传递中断。

## 解法

- 新增 `STOP_GRACE_MS = 8_000`（`src/daemon/daemon.ts`）。`stopDaemon` 对 supervisor 和遗留桥接进程都先发 SIGTERM，等待宽限期后才强杀。
- supervisor 增加 `stopGraceMs` 选项，默认 6 秒（短于 daemon 的 8 秒，保证升级顺序）。POSIX 上先发 SIGTERM 并启动强杀定时器，子进程正常退出时清除定时器；Windows 仍直接 taskkill，因为 Node 在 Windows 上不向 JS 处理器投递 SIGTERM。
- `IlinkClient.get` 合并外部 signal；`fetchQRCode` 与 `pollQRStatus` 接受并传递 signal，轮询被外部中断时抛 AbortError 而不是返回 `wait`。
- `loginWithQR` 在每次轮询前检查信号，轮询间隔改用 `timers/promises` 的 delay，配对码输入用 `rl.close()` 让挂起的 question 以 AbortError 结束。
- `src/index.ts` 首次退出信号启动 30 秒兜底看门狗（不阻止事件循环自然退出）；再次收到信号立即退出，SIGINT 返回 130、SIGTERM 返回 143。

## 涉及模块

`src/daemon/daemon.ts`、`src/daemon/supervisor.ts`、`src/ilink/client.ts`、`src/ilink/login.ts`、`src/index.ts`。

## 复发预防

- 新增停止阶段的测试必须使用真实子进程：优雅退出用例验证子进程收到 SIGTERM 后写出的收尾标记；宽限期用例验证忽略 SIGTERM 的子进程最终被强杀；遗留桥接用例走 `stopDaemon` 无 supervisor 分支。三个用例仅在 POSIX 运行。
- 扫码轮询改用真实本地 HTTP 连接并让响应挂起，确认 AbortError 在 1.5 秒内返回。
- 验证结果：typecheck、build 通过，177 项测试通过、7 项按平台跳过。

关联：[桥接运行可靠性](../entities/bridge-reliability.md)、[后台守护进程](../entities/background-daemon.md)。
