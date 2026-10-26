---
title: 1.7.2 发布记录
type: query
tags: [发布, npm, GitHub, 依赖升级]
created: 2026-10-26
updated: 2026-10-26
sources: []
status: active
---

## 问题

用户要求发布 1.7.2。相对 1.7.1 的内容是并入 PR #3 的升级部分：pi-coding-agent 0.82.0 → 1.4.0、Homebrew 分离 formula 布局的 npm 入口查找、`fast-xml-parser` 显式依赖，以及锁文件源主机归一化。

## 根因与依据

发布前 registry 的 latest 与 GitHub 正式 Release 均为 1.7.1，main 的 `package.json` 版本为 1.7.1，工作区干净，[合并 PR #3](pr-3-pi-core-upgrade.md) 提交 `22d970f` 的三平台 CI 已通过。

## 解法

1. `npm version 1.7.2 --no-git-tag-version` 修改版本号，同步 `package-lock.json` 根包版本。
2. CHANGELOG 将 Unreleased 段落确定为 `## [1.7.2] - 2026-10-26`，保留空的 Unreleased 段；版本段首行写明对应 [PR #3](https://github.com/ReachForStar/pi-weixin-bridge/pull/3)，Release 正文由脚本从 CHANGELOG 提取，因此 PR 引用随正文一并进入 Release。
3. 提交 `ec2784f` 推送 main：`package.json` 版本变化触发发布，publish 任务成功。
4. 官方 registry 核验：`latest` 与 `version` 均为 1.7.2，tarball 为 `https://registry.npmjs.org/pi-weixin-bridge/-/pi-weixin-bridge-1.7.2.tgz`；[Release v1.7.2](https://github.com/ReachForStar/pi-weixin-bridge/releases/tag/v1.7.2) 非草稿、非预发布，指向 `ec2784f`，正文与 CHANGELOG 的 1.7.2 段落一致。
5. 补 PR 引用时 Release 已发布：CI 不会为无版本变化的推送重写已存在的 Release，因此用 GitHub API `PATCH /repos/.../releases/<id>` 更新正文，再用 `extract-changelog.mjs` 输出对比读回正文确认一致。

## 验证

- 本地：`npm ci`、`npm run typecheck`、`npm run build` 通过；`npm test` 155 通过、7 项按平台跳过
- `npm pack --dry-run`：55 个条目、102 KB，不含 `test/`、`tmp/`、`docs/`
- CI（[40277881017](https://github.com/ReachForStar/pi-weixin-bridge/actions/runs/40277881017)）：ubuntu、macOS、windows 三平台 check 与 publish 全部 success

## 涉及模块

[发布确认](../decisions/manual-release-confirmation.md)、[npm 分发](../decisions/npm-distribution.md)、[合并 PR #3](pr-3-pi-core-upgrade.md)、[供应方读取与会话模型配置](../entities/model-configuration.md)。

## 复发预防

- 版本号变化是发布的唯一触发条件，发布前确认 registry latest 与 main 版本一致，避免漏发或重发。
- `Release` 正文由 `scripts/extract-changelog.mjs` 从 CHANGELOG 提取，因此版本段必须先于推送写入，标题必须写成 `## [x.y.z] - 日期`。
- Release 正文里的 PR 引用写进 CHANGELOG 版本段首行，避免两处内容不一致；发布后才补引用需直接改 Release 正文（原工作流只在版本变化时创建 Release，已存在的 Release 不会被后续推送更新）。gh 2.4.0 无 `release edit`，改用 `gh api -X PATCH`。
- 未在本机执行全局更新或改动用户自启；用户升级时仍需先停止后台再安装，见 [Windows 全局更新 EBUSY](npm-global-install-ebusy.md)。
