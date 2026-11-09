---
title: 桥接运行可靠性
type: entity
tags: [桥接, HTTP, 退出, 文本]
created: 2026-09-30
updated: 2026-11-09
status: active
---

## 职责

保证消息轮询、后台重登等待、HTTP 请求、扫码登录和文本分块在异常边界下能够结束并保留有效文本。

## 关键文件与接口

- `src/bridge.ts`：失败退避使用 Node timers/promises 的 setTimeout 并传入退出信号。
- `src/account.ts`：等待账号更新使用同一标准库接口，等待结束后退出监听器由标准库移除。
- `src/ilink/client.ts`：post/get 的超时保护覆盖 fetch 和响应正文读取，响应正文网络错误进入现有错误分类；已中断的外部信号立即传递。get 与扫码状态轮询接受外部信号。
- `src/ilink/login.ts`：二维码获取、状态轮询、过期刷新、配对码输入和轮询间隔都接受退出信号；输入等待被关闭时以 AbortError 结束；配对码输入受剩余登录时间约束并拒绝空值。
- `src/ilink/media.ts`：附件生效上限取配置值与 64MiB 服务器硬上限的较小值，图片、文件、视频超限统一抛 MediaTooLargeError（含实际大小与生效上限）。
- `src/index.ts`：首次退出信号优雅停止并启动 30 秒兜底看门狗；再次收到信号立即退出（SIGINT 130 / SIGTERM 143）。
- `src/message/markdown.ts`：chunkText 要求 maxLen 为至少 2 的安全整数，以 UTF-16 单元限制块长度，同时保持合法代理对完整。
- `test/reliability.test.ts`：使用真实本地 HTTP 连接验证挂起正文、扫码轮询中断与退出等待，不替换网络函数。

## 上下游依赖

依赖 Node 标准库、iLink 客户端和 pi 会话管理器；不新增第三方依赖。

## 重要变更记录

2026-11-09：全库审查修复。附件上限不再被 `maxFileBytes` 直接突破；空模型回复只发一条结束语；用户停止定时任务不再误报投递失败。扫码轮询只把客户端自身超时当 `wait`，鉴权/网络/协议错误向上抛出；配对码输入受总登录时间约束。验证：typecheck、build 通过，187 项测试通过、7 项按平台跳过。见 [全库审查问题修复](../queries/full-repo-review-fixes.md)。

2026-11-09：扫码登录期间 Ctrl+C/SIGTERM 原先无效，最长要等满 35 秒轮询或人工输入；现在 GET 请求、状态轮询、二维码刷新、配对码输入与轮询间隔都响应退出信号。首次退出后若模型或网络调用仍挂起，30 秒看门狗强制退出；第二次信号立即退出。验证：typecheck、build 通过，177 项测试通过、7 项按平台跳过；新增真实连接扫码轮询中断测试。见 [优雅停止与可中断登录](../queries/graceful-shutdown-login-abort.md)。

2026-09-30：类型检查、构建与全部测试通过（107 通过，1 项 POSIX 权限测试在 Windows 跳过）。新增真实 HTTP 正文挂起、预先中断请求、退避退出与监听器清理测试，以及分块非法长度和表情完整性测试。问题来源见 [发布前可靠性检查](../queries/pre-release-reliability.md)。
