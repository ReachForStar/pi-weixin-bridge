---
type: index
updated: 2026-10-01
---

# Wiki 索引

> 人工/Agent 显式查阅用的完整目录；会话中的导航由 wiki-memory hook 注入的目录树提供。
> 格式：`[页面标题](相对路径) — 一行摘要`。

## 实体 entities

- [桥接运行可靠性](entities/bridge-reliability.md) — 退出等待、请求超时与文本分块边界。
- [对话恢复与任务通知](entities/conversation-recovery.md) — 持久会话、全流程串行、任务查询与精确取消、进度及失败通知。
- [入站文档自动转换](entities/inbound-documents.md) — 附件保存、文档转换和失败通知。
- [anydoc 依赖](entities/anydoc.md) — 固定版本、格式识别与禁止自动云端 OCR。
- [后台守护进程](entities/background-daemon.md) — 后台启动、独占锁、等待扫码与真实子进程停止验证。
- [微信功能服务与权限](entities/feature-services.md) — 十项功能、模型选择、执行权限与验证边界。
- [供应方读取与会话模型配置](entities/model-configuration.md) — 扫码后默认模型选择、会话独立切换与 CLI 帮助。

- [CLI 配置入口](entities/config-command.md) — 独立交互配置、模型选择、字段校验与生效边界。

## 概念 concepts

## 源总结 sources

## 决策 decisions

- [发布前人工确认](decisions/manual-release-confirmation.md) — 确认后修改版本并推送，CI 仅在版本变化时发布。
- [npm 统一安装与版本分发](decisions/npm-distribution.md) — GitHub 保存源码，用户从 npm 安装和更新。

## 查询沉淀 queries

- [发布前可靠性检查](queries/pre-release-reliability.md) — 发布确认约束与消息处理待修复问题。
- [后续功能候选](queries/feature-candidates.md) — 早期候选已实现，当前状态见微信功能服务。
- [微信桥接功能扩展调研](queries/feature-roadmap-research.md) — 文件回传、会话管理、资料库与自动化等十项候选及协议约束。

- [1.7.0 发布记录](queries/release-1-7-0.md) — 发布授权、版本检查与 npm/GitHub 实际结果。

- [Windows 全局更新 EBUSY](queries/npm-global-install-ebusy.md) — 旧后台占用 npm 包目录与升级后模型配置要求。

- [Windows 快捷方式脚本路径空格](queries/windows-shortcut-spaces.md) — npm 包路径空格、PowerShell 参数传递与失败退出。

- [Windows 快捷方式脚本路径空格](queries/windows-shortcut-spaces.md) — npm 包路径空格、PowerShell 参数传递与失败退出。
