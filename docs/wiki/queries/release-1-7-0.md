---
title: 1.7.0 发布记录
type: query
tags: [发布, npm, GitHub]
created: 2026-09-30
updated: 2026-09-30
status: draft
---

## 问题

用户明确要求发布新版本，将已完成功能和 npm 安装文档提供给用户。

## 根因与依据

npm 和 GitHub 最新版本均为 1.6.1；远程 main 是当前提交的祖先，没有额外提交。GitHub 登录有效，仓库配置了 NPM_TOKEN secret；其有效性须以实际发布结果确认。

## 解法

新增功能使用次版本号 1.7.0，同步 package.json、锁文件和 CHANGELOG。完成本地检查后推送 main，由版本变化触发 CI 发布。本地类型检查、构建、24 个测试文件均通过（141 项通过、1 项 Windows 平台跳过）；真实 CLI 帮助、npm 打包文件、CI 版本条件、wiki 元数据和相对链接校验通过。发布状态待核验。

## 涉及模块

[发布确认](../decisions/manual-release-confirmation.md)、[npm 分发](../decisions/npm-distribution.md)、[功能服务](../entities/feature-services.md)。

## 复发预防

发布前取得人工确认，核对 npm 和 GitHub 现有版本；发布后读取 registry 和 Release 实际状态，不能用推送成功代替发布成功。
