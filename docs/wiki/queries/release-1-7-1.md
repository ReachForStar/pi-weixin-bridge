---
title: 1.7.1 发布记录
type: query
tags: [发布, npm, GitHub, Windows]
created: 2026-10-01
updated: 2026-10-01
status: active
---

## 问题

用户于 2026-10-01 明确要求合并代码到主分支并发布新版本，授权发布已准备的 1.7.1。Issue #1 回复需先由用户确认文案，不自动发送或关闭。

## 根因与依据

发布前 registry 的 latest 与 GitHub 正式 Release 均为 1.7.0；开发分支 package.json 为 1.7.1。工作区干净，[开发分支 CI 36810549465](https://github.com/ReachForStar/pi-weixin-bridge/actions/runs/36810549465) 已通过三平台检查。后续补全 CHANGELOG 与本发布记录，仅修改文档。

## 解法

通过 [PR #2](https://github.com/ReachForStar/pi-weixin-bridge/pull/2) 合并开发分支，main 版本从 1.7.0 变为 1.7.1，合并提交为 4a0b9d4565dbbeb79679c67e13bba223baab60a0。[main CI 36811222768](https://github.com/ReachForStar/pi-weixin-bridge/actions/runs/36811222768) 的三平台检查及发布全部成功。

正式 [Release v1.7.1](https://github.com/ReachForStar/pi-weixin-bridge/releases/tag/v1.7.1) 已创建，非草稿、非预发布，标签直接指向上述合并提交。npm 上传日志提示处理需要数分钟，初次 registry 返回 404、latest 为 1.7.0；后续通过官方 registry 强制在线核验确认 version 与 latest 均为 1.7.1，tarball 为 https://registry.npmjs.org/pi-weixin-bridge/-/pi-weixin-bridge-1.7.1.tgz 。未在本机执行全局更新或更改用户自启。

按用户追加要求删除本地及远程 codex/reliability-version-release 分支。主分支在另一工作区检出，当前工作区保持主分支合并提交的 detached HEAD；发布结果知识记录提交到 main，版本不变，不再触发 npm 发布。Issue #1 的回复文案已准备，仍待用户确认，不自动发送或关闭。

## 涉及模块

[发布确认](../decisions/manual-release-confirmation.md)、[npm 分发](../decisions/npm-distribution.md)、[Windows 原生接口](../entities/windows-native-com.md)、[模型失败通知验收](../sources/model-failure-validation-output.md)、[Issue 检查](github-issues-review.md)。

## 复发预防

本次发布授权不等于 Issue 文案授权；发布完成后提供具体回复文本供用户确认。Windows npm 安装需要 VS2022 C++ 工具与 Python，升级前停止后台，正式 npm 自启应重新注册到安装路径，避免继续依赖开发工作区。
