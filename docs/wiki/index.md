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

- [Windows macOS Linux 适配](entities/platform-support.md) — 系统工具、自启方式、旧路径兼容与三平台 CI。
- [Windows 原生 COM 绑定](entities/windows-native-com.md) — 固定版本 winax、构建要求与原生模块安装校验。

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

- [Windows 快捷方式脚本路径空格](queries/windows-shortcut-spaces.md) — 先前路径解析故障，已由终端无关机制取代。
- [终端无关运行机制与 Windows CI](queries/windows-shell-independence.md) — Node 入口、Windows 原生接口与真实验证边界。
- [GitHub 已知问题检查](queries/github-issues-review.md) — Issue #1 的五项旧版本缺陷与当前开发分支对应机制。
- [登录自启与模型失败通知验收](queries/login-notification-validation.md) — 真实系统登录、模型请求故障注入、通过判据和恢复方式。
- [Windows 登录任务注册账户错误](queries/windows-task-logon-failure.md) — 实际注册失败、进程 SID 与空 COM 密码参数。
- [用户 Windows 自启注册失败输出](sources/windows-task-registration-output.md) — 注册失败的终端证据与旧日志边界。
