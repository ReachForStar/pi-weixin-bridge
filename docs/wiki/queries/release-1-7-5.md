---
title: 1.7.5 发布记录
type: query
tags: [发布, npm, GitHub, 审查修复]
created: 2026-11-09
updated: 2026-11-09
status: active
---

## 问题

用户要求发布补丁版本。相对 1.7.4 的内容是全库审查确认的 23 组修复：状态与配置读取、定时任务停止语义、扫码登录与 HTTP 错误处理、会话创建窗口、附件上限与 Windows/macOS 进程边界等。

## 根因与依据

发布前 registry 的 `latest` 与 GitHub 正式 Release 均为 1.7.4，main 版本为 1.7.4，工作区干净。上一轮审查修复提交 `605f2ac` 的三平台 CI（42597588946）已通过。

## 解法

1. `npm version 1.7.5 --no-git-tag-version` 修改版本号，同步 `package-lock.json` 根包版本（此前锁文件根版本停留在 1.7.2）。
2. CHANGELOG 将 Unreleased 段落确定为 `## [1.7.5] - 2026-11-09`，保留空的 Unreleased 段。
3. 提交 `4aae998` 推送 main：版本变化触发 publish，三平台 check 与 publish 全部成功（[42608259965](https://github.com/ReachForStar/pi-weixin-bridge/actions/runs/42608259965)）。
4. 官方 registry 核验：`latest` 与 `version` 均为 1.7.5，tarball 为 `https://registry.npmjs.org/pi-weixin-bridge/-/pi-weixin-bridge-1.7.5.tgz`；[Release v1.7.5](https://github.com/ReachForStar/pi-weixin-bridge/releases/tag/v1.7.5) 非草稿、非预发布，指向 `4aae998`，正文由 CHANGELOG 提取。
5. npm 发布返回 “being processed”，约 1 分钟后 `dist-tags.latest` 更新为 1.7.5；未重复发布。

## 验证

- 本地：`npm run typecheck`、`npm run build` 通过；`npm test` 187 通过、7 项按平台跳过。
- `npm pack --dry-run`：58 个条目、135.9 kB 包体、390.1 kB 解包，不含 `test/`、`tmp/`、`docs/`。
- CI check：ubuntu 1m6s、macOS 1m26s、windows-2022 3m36s 全部 success；publish 16s success。

## 涉及模块

[发布前人工确认](../decisions/manual-release-confirmation.md)、[npm 分发](../decisions/npm-distribution.md)、[全库审查问题修复](full-repo-review-fixes.md)、[优雅停止与可中断登录](graceful-shutdown-login-abort.md)。

## 复发预防

- 版本号变化是发布的唯一触发条件；发布前确认 registry latest 与 main 版本一致。
- CHANGELOG 版本段必须先于推送写入，标题保持 `## [x.y.z] - 日期`，Release 正文由 `scripts/extract-changelog.mjs` 提取。
- npm 发布后的短暂 `being processed` 属正常传播延迟；确认 `dist-tags.latest` 与 tarball 可访问后再报告完成。