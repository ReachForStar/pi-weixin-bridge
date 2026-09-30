---
title: CLI 配置入口
type: entity
tags: [CLI, 配置, 模型]
created: 2026-09-30
updated: 2026-10-01
status: active
---

## 职责

通过 pi-weixin-bridge config 管理现有桥接配置，无需重新扫码或执行完整安装。真实 CLI 与交互输入流验证通过。

## 关键文件与接口

- src/config-command.ts：无参数时交互菜单，非交互只显示配置与帮助；show/get/set/unset/models/model。
- src/config.ts：统一结构、权限、文件上限和日预算校验；保存时合并字段，通过同目录临时文件与 rename 原子替换。
- src/wizard.ts：共享缓存输入行的 LineReader，避免快速输入或 EOF 丢失答案。
- src/cli.ts：config 命令分发和专用帮助。
- src/pi/sessions.ts：缺失或失效默认模型时提示 config model。

## 上下游依赖

复用 Node 标准库与 pi SDK 实际供应方/模型目录，不引入依赖，不显示 pi 供应方密钥，不发送模型请求。配置保存到固定的 ~/.pi-weixin-bridge/config.json，环境变量优先。

## 重要变更记录

版本号按用户要求准备为 1.7.1。交互菜单一次修改一项，空输入取消；模型先选择供应方，再选模型。命令行模型支持当次列表编号或完整引用。数组、对象、数字使用 JSON.parse。修改嵌套值保留兄弟字段；清除管理员与白名单保留空列表，清除整个 access 则明确提示恢复个人完整权限。

状态目录和工作目录变更前拒绝仍运行的后台；不自动迁移账号或会话，保存后提示重启并重新注册路径相关自启。默认模型配置不替换已有会话模型偏好。无效值在写入之前拒绝。

## 验证与边界

类型检查、构建和 26 个测试文件通过（150 项通过、1 项 Windows 权限测试跳过）。真实 CLI 子进程验证 SDK 模型列表、模型选择、配置合并、环境变量覆盖、非法值不改写、项目和路径解析；真实后台启动后拒绝修改路径，停止后允许保存。输入流验证快速菜单输入、模型选择和 EOF 不写入。打包含配置入口和双语文档，wiki 链接与元数据校验通过。1.7.1 尚未发布；推送 main 中的版本变化会触发发布，须在用户确认后进行。已安装的 1.7.0 尚缺少此命令。

关联：[模型配置](model-configuration.md)、[后台守护进程](background-daemon.md)、[npm 分发](../decisions/npm-distribution.md)、[EBUSY 排查](../queries/npm-global-install-ebusy.md)、[发布确认](../decisions/manual-release-confirmation.md)。
