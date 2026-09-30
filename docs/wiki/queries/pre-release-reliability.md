---
title: 发布前可靠性检查
type: query
tags: [发布, 消息处理, 超时]
created: 2026-09-30
updated: 2026-09-30
status: active
---

## 问题

用户要求完善项目，并在发布新版本前确认。当前版本为 package.json 中的 1.6.1，用户已确认并完成依赖安装。

## 根因

静态读取确认：

- `.github/workflows/ci.yml` 的 publish 在 push main 且 check 成功后执行，无人工触发条件。
- `src/bridge.ts` 的错误退避仅使用 setTimeout，退出信号不能中断等待，连续失败五次后等待 30 秒。
- `src/ilink/client.ts` 的 post/get 在 fetch 返回后清除定时器，再调用 res.text()，响应正文读取未被请求定时器覆盖。
- `src/message/markdown.ts` 的 chunkText 没有校验 maxLen。长文本传入 0 或负数时，硬切循环不能终止；slice 按 UTF-16 单元切割，可能拆开代理对。

## 解法

已实现中断退避等待、将请求定时器覆盖到正文读取、校验分块长度并保护代理对。后台重登等待改用标准库定时器，修复退出监听器累积。按用户最新要求，仅在 main 推送前后版本号改变时发布；版本号修改及推送先由用户确认。

## 涉及模块

桥接消息循环、iLink HTTP 客户端、文本分块、GitHub Actions 发布配置。

## 复发预防

类型检查、全部测试和构建通过：107 项测试通过，1 项 POSIX 权限测试在 Windows 跳过。新增测试用真实本地 HTTP 连接覆盖正文挂起和异常退避，用退出监听器计数覆盖后台重登等待。关联：[桥接运行可靠性](../entities/bridge-reliability.md)、[发布前人工确认](../decisions/manual-release-confirmation.md)。微信真实账号端到端运行和远程发布未执行。
