---
title: 1.7.1 发布记录
type: query
tags: [发布, npm, GitHub, Windows]
created: 2026-10-01
updated: 2026-10-01
status: draft
---

## 问题

用户于 2026-10-01 明确要求合并代码到主分支并发布新版本，授权发布已准备的 1.7.1。Issue #1 回复需先由用户确认文案，不自动发送或关闭。

## 根因与依据

发布前 registry 的 latest 与 GitHub 正式 Release 均为 1.7.0；开发分支 package.json 为 1.7.1。工作区干净，[开发分支 CI 36810549465](https://github.com/ReachForStar/pi-weixin-bridge/actions/runs/36810549465) 已通过三平台检查。后续补全 CHANGELOG 与本发布记录，仅修改文档。

## 解法

通过 PR 合并开发分支，main 版本从 1.7.0 变为 1.7.1 后触发既有发布工作流。待核验：main CI、npm registry latest、正式 GitHub Release 及标签指向。不能把 PR 合并或推送成功当作发布完成。

## 涉及模块

[发布确认](../decisions/manual-release-confirmation.md)、[npm 分发](../decisions/npm-distribution.md)、[Windows 原生接口](../entities/windows-native-com.md)、[模型失败通知验收](../sources/model-failure-validation-output.md)、[Issue 检查](github-issues-review.md)。

## 复发预防

本次发布授权不等于 Issue 文案授权；发布完成后提供具体回复文本供用户确认。Windows npm 安装需要 VS2022 C++ 工具与 Python，升级前停止后台，正式 npm 自启应重新注册到安装路径，避免继续依赖开发工作区。
