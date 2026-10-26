---
title: 桥接运行可靠性
type: entity
tags: [桥接, HTTP, 退出, 文本]
created: 2026-09-30
updated: 2026-09-30
status: active
---

## 职责

保证消息轮询、后台重登等待、HTTP 请求和文本分块在异常边界下能够结束并保留有效文本。

## 关键文件与接口

- `src/bridge.ts`：失败退避使用 Node timers/promises 的 setTimeout 并传入退出信号。
- `src/account.ts`：等待账号更新使用同一标准库接口，等待结束后退出监听器由标准库移除。
- `src/ilink/client.ts`：post/get 的超时保护覆盖 fetch 和响应正文读取，响应正文网络错误进入现有错误分类；已中断的外部信号立即传递。
- `src/message/markdown.ts`：chunkText 要求 maxLen 为至少 2 的安全整数，以 UTF-16 单元限制块长度，同时保持合法代理对完整。
- `test/reliability.test.ts`：使用真实本地 HTTP 连接验证挂起正文与退出等待，不替换网络函数。

## 上下游依赖

依赖 Node 标准库、iLink 客户端和 pi 会话管理器；不新增第三方依赖。

## 重要变更记录

2026-09-30：类型检查、构建与全部测试通过（107 通过，1 项 POSIX 权限测试在 Windows 跳过）。新增真实 HTTP 正文挂起、预先中断请求、退避退出与监听器清理测试，以及分块非法长度和表情完整性测试。问题来源见 [发布前可靠性检查](../queries/pre-release-reliability.md)。
