---
title: npm 统一安装与版本分发
type: decision
tags: [安装, npm, 发布]
created: 2026-09-30
updated: 2026-09-30
status: active
---

## 背景

用户要求 GitHub 保存源码，发布包到 npm，所有用户安装说明统一使用 npm。

## 备选方案

- 多个安装来源：便于运行未发布源码，但入口和后台包路径生命周期各不相同。
- npm 全局安装：版本来自 npm 已发布包，后台与自启使用稳定包路径，符合用户要求。

## 决策

使用 npm install -g pi-weixin-bridge，再执行 pi-weixin-bridge install。更新从 npm 安装 latest，移除 CLI 中 Git 拉取更新与 npx 提示。更新前停止后台，失败保持停止，成功后重新启动。GitHub 保留开发源码、测试和发布工作流；历史 CHANGELOG 中旧安装行为保留为历史记录。

## 理由

稳定包路径避免临时缓存移除导致后台崩溃后无法再次启动。更新前停止正在运行的 TypeScript 源码，避免包替换期间加载不同版本文件。统一 README、CLI help 与英文文档。

## 后果

自启仍依赖 npm 包与 Node 路径存在；Node 安装路径变化后需要重新注册。卸载先停止服务和移除自启，再 npm uninstall -g pi-weixin-bridge；本地账号和配置保留。真实 CLI help 与 npm pack --dry-run 检查通过，包内包含完整 src、转换 worker 和双语 README，不包含 tmp/test；没有执行实际全局更新。用户已确认发布 1.7.0，npm 发布结果见[发布记录](../queries/release-1-7-0.md)。

关联：[发布前人工确认](manual-release-confirmation.md)、[后台守护进程](../entities/background-daemon.md)、[供应方读取与会话模型配置](../entities/model-configuration.md)。
