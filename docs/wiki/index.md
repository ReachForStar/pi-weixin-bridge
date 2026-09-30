---
type: index
updated: 2026-09-30
---

# Wiki 索引

> 人工/Agent 显式查阅用的完整目录；会话中的导航由 wiki-memory hook 注入的目录树提供。
> 格式：`[页面标题](相对路径) — 一行摘要`。

## 实体 entities

- [桥接运行可靠性](entities/bridge-reliability.md) — 退出等待、请求超时与文本分块边界。
- [对话恢复与任务通知](entities/conversation-recovery.md) — 持久会话、/new、进度及失败通知。
- [入站文档自动转换](entities/inbound-documents.md) — 附件保存、文档转换和失败通知。
- [anydoc 依赖](entities/anydoc.md) — 固定版本、格式识别与禁止自动云端 OCR。

## 概念 concepts

## 源总结 sources

## 决策 decisions

- [发布前人工确认](decisions/manual-release-confirmation.md) — 确认后修改版本并推送，CI 仅在版本变化时发布。

## 查询沉淀 queries

- [发布前可靠性检查](queries/pre-release-reliability.md) — 发布确认约束与消息处理待修复问题。
- [后续功能候选](queries/feature-candidates.md) — 对话恢复和通知已实现，白名单待选择。
