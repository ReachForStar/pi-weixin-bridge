---
title: 后续功能候选
type: query
tags: [功能, 会话, 安全]
created: 2026-09-30
updated: 2026-09-30
status: draft
---

## 问题

用户希望修复现有问题后获得可增加功能的建议，随后选定对话恢复和任务通知，白名单仍为候选。后续已实现任务查询和精确取消；2026-09-30 的扩展调研见 [微信桥接功能扩展调研](feature-roadmap-research.md)。

## 根因

- src/bridge.ts 对用户消息按类型过滤，未在处理入口校验发送者白名单。
- 原 src/pi/sessions.ts 使用 SessionManager.inMemory，重启会丢失上下文；现已改用 SDK 持久会话。
- 原 src/bridge.ts 只发送输入状态，失败只记录日志；现已增加进度和终止通知。

## 解法

功能状态：

1. 微信用户白名单：只允许指定用户调用 Agent，优先限制入口权限。
2. 对话持久化与恢复：已实现，/new 切换新对话并保留旧记录，尚无自动删除期限。
3. 任务进度与失败通知：已实现，长任务每 30 秒更新阶段和耗时，失败或停止时发送提示。

## 涉及模块

桥接入口与 pi 会话管理器；相关实现见 [对话恢复与任务通知](../entities/conversation-recovery.md)、[桥接运行可靠性](../entities/bridge-reliability.md)。

## 复发预防

白名单待用户选择。对话恢复和通知已通过本地验证，详见模块页面的验证范围。
