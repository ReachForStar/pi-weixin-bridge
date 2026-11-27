---
title: 1.7.6 发布记录
type: query
tags: [发布, npm, GitHub, pi-sdk]
created: 2026-11-27
updated: 2026-11-27
status: active
---

## 问题

用户要求发布新版本并写好 Release 说明。相对 1.7.5 的内容是 pi 核心 `@earendil-works/pi-coding-agent` 1.4.0 → 1.6.1 升级，以及退出前等待 SDK 凭据写入；另有前一轮遗留的 `npm audit` 复核未完成。

## 根因与依据

`npm audit --omit=dev` 因 registry 审计接口 ECONNRESET 一直未能运行，导致升级记录只能写「待复核」。本次重跑成功，生产链报告 0 项；完整 `npm audit` 报 7 项（1 low、1 moderate、3 high、2 critical），全部来自开发依赖：

- `vitest@3.2.7` 及其 `tinypool@1.1.1`、`@vitest/mocker@3.2.7`：修复需升 `vitest@5`（破坏性）。
- `vite@7.3.6`、`postcss` 链的 `nanoid@3.3.16`、`source-map-js@1.2.1`：有非破坏性修复可用。
- `fast-xml-parser@5.11.2`（测试用 devDependency）：有非破坏性修复可用。

这些包不进入发布产物（`devDependencies`），不影响 npm 安装后的运行；本次发布不夹带测试工具链升级。

## 解法

1. `npm version 1.7.6 --no-git-tag-version` 修改版本号，`package.json`、`package-lock.json` 根版本同步为 1.7.6。
2. CHANGELOG 的 Unreleased 段落定为 `## [1.7.6] - 2026-11-27`，改写为面向用户的 Release 说明：pi 核心升级带来的上游改进、undici 8.12.4 解除审计已知问题、退出前等待凭据写入。
3. 提交 `3374339` 推送 main 触发发布；GitHub Release 正文由 `scripts/extract-changelog.mjs` 从 CHANGELOG 提取。

## 验证

- 本地：`npm run typecheck`、`npm run build` 通过；`npm test` 187 通过、7 项按平台跳过。
- `npm pack --dry-run`：58 个条目、136.4 kB 包体、391.1 kB 解包，不含 `test/`、`tmp/`、`docs/`。
- CI [45974907920](https://github.com/ReachForStar/pi-weixin-bridge/actions/runs/45974907920)：check 的 ubuntu（1m24s）、macOS（2m16s）、windows-2022（3m41s）与 publish（18s）全部 success。
- registry：[npm 1.7.6](https://www.npmjs.com/package/pi-weixin-bridge/v/1.7.6) 的 `latest` 与 `version` 均为 1.7.6，tarball 返回 200；下载 tarball 核对 `version=1.7.6`、依赖 `@earendil-works/pi-coding-agent=1.6.1`。
- [Release v1.7.6](https://github.com/ReachForStar/pi-weixin-bridge/releases/tag/v1.7.6) 非草稿、非预发布，指向 `3374339`，正文含 Changed 与 Fixed 两段。

## 涉及模块

[发布前人工确认](../decisions/manual-release-confirmation.md)、[npm 统一安装与版本分发](../decisions/npm-distribution.md)、[升级 pi 核心到 1.6.1](pi-core-1-6-1-upgrade.md)、[微信功能服务与权限](../entities/feature-services.md)。

## 复发预防

- 发布前先确认 registry `latest`、主分支版本号与既有 Release 一致；版本号变化是唯一发布触发条件。
- 发布说明直接决定 GitHub Release 正文，CHANGELOG 版本段必须写成用户可读的变更与修复，不写实现细节。
- 审计接口偶发 ECONNRESET，重试后再判定；生产链与开发链分开报告（`--omit=dev`）。
- 开发依赖漏洞未修复时，在发布记录写明包名、等级与修复路径，避免下次重复调查。
