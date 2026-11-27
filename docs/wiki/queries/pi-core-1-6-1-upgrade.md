---
title: 升级 pi 核心到 1.6.1
type: query
tags: [依赖升级, pi-sdk, 会话, 凭据]
created: 2026-11-27
updated: 2026-11-27
sources: []
status: active
---

## 问题

桥接固定依赖 `@earendil-works/pi-coding-agent@1.4.0`，npm 最新版本为 1.6.1（中间经过 1.5.0、1.5.1、1.6.0、1.6.1）。需要判断哪些破坏性变更影响桥接、哪些新接口需要在桥接层接入，并验证升级后会话创建、工具权限与扩展事件仍然正确。

## 变更核对

1.4.0 → 1.6.1 共有四条 Breaking Changes，桥接均未触及：

- 1.5.0：工具参数改由 `@earendil-works/pi-schema` 校验，TypeBox 中超出 JSON Schema 的特性（`Type.Refine()`、`Type.BigInt()`、`Type.Undefined()`、codec、自定义 format）不再生效。桥接三个自定义工具只用 `Type.Object` 与 `Type.String({ description })`，属纯 JSON Schema。
- 1.5.1：`GrepOperations.readFile` 不再为上下文行回调（字段仍可选保留）。桥接不实现该回调。
- 1.6.0：扩展组件的 `render()` 返回 `readonly string[]`。桥接扩展工厂只注册 `tool_call` 处理器，不渲染组件。
- 1.6.1：删除 `SettingsManager.getShowCacheMissNotices()` 与 `setShowCacheMissNotices()`，改为 `getNotices()` / `setNotice()`。桥接不读设置管理器。

新增接口中只有 `ModelRuntime.settleCredentialWrites()` 与桥接相关：1.5 以后 SDK 会后台刷新模型目录、可能轮换 OAuth 令牌，SDK 要求宿主在进程退出前等待写入完成，否则轮换后的令牌丢失。

## 解法

1. `package.json` 依赖改为固定版本 `1.6.1`，执行 `npm install` 重新生成锁文件（248 条 `resolved` 全部为 `registry.npmjs.org`）。
2. `src/pi/sessions.ts` 新增 `settleCredentialWrites()`，转发 `ModelRuntime.settleCredentialWrites()`；`src/index.ts` 的 finally 在 `pi.dispose()` 之前调用它，失败只记警告，不阻断实例锁释放。
3. 保留 `bindExtensions({})` 补调：1.6.1 的 `dist/core/sdk.js` 仍不调用 `bindExtensions`；实测未绑定时 `session_start` 计数为 0，绑定后为 1（reason `startup`）。
4. 依赖链 `undici` 由 8.10.2 升到 8.12.4，README 记录的审计已知问题解除，中英文 README 同步删除该条。

## 验证

- `npm run typecheck`、`npm run build` 通过；桥接业务代码零类型改动，只新增退出等待方法。
- `npm test`：187 通过、7 按平台跳过（28 个文件通过、1 个文件整体跳过），与升级前基线一致。其中「真实 SDK 工具权限与导出」用 1.6.1 真实 `createAgentSession` 创建会话，触发扩展 `tool_call` 拦截并导出 HTML。
- 退出路径实测：`PI_WEIXIN_HEADLESS=1` 启动真实 `src/index.ts`（临时 agent 目录、状态目录与工作目录），进入「后台模式无法扫码」后发送 SIGTERM，日志按「收到退出信号 → 已退出」结束。
- `settleCredentialWrites` 实测：未初始化时直接返回；注入真实 `ModelRuntime` 后调用成功。

## 未改变的既有行为与风险

- 1.5.1 起 `cacheWarming` 默认由 `streaming` 改为 `idle`：会话结束后的空档期最多 30 分钟内仍可能按成本判断后台刷新缓存。桥接沿用用户 `~/.pi/agent/settings.json`，不覆盖该设置。
- `enabledModels` 等配置警告由 SDK 写入 stderr，进入桥接日志，不影响会话。
- `npm audit` 已实际运行：`npm audit --omit=dev` 为 0 项，生产链 `undici@8.12.4` 高于修复线；完整 `npm audit` 为 7 项（1 low、1 moderate、3 high、2 critical），全部在开发依赖：`vitest@3.2.7` 链（`tinypool`、`@vitest/mocker`，修复需升 vitest 5）、`vite@7.3.6` 与 `postcss` 链（`nanoid`、`source-map-js`）、测试用 `fast-xml-parser@5.11.2`。这些包不进入发布产物，本次未夹带测试工具链升级，见[1.7.6 发布记录](release-1-7-6.md)。

## 涉及模块

`package.json`、`package-lock.json`、`src/pi/sessions.ts`、`src/index.ts`、`README.md`、`README_en.md`、`CHANGELOG.md`；关联[供应方读取与会话模型配置](../entities/model-configuration.md)、[SDK 会话不触发 session_start](sdk-session-start-hooks.md)、[合并 PR #3](pr-3-pi-core-upgrade.md)、[桥接运行可靠性](../entities/bridge-reliability.md)。

## 复发预防

- 升级 pi 核心后，用「绑定前后各数一次 `session_start`」实测复核扩展事件，不要只读源码推断。
- 桥接自定义工具参数保持纯 JSON Schema，不使用 pi-schema 不支持的 TypeBox 特性。
- SDK 新增的「宿主负责的收尾接口」（如 `settleCredentialWrites()`）在退出路径接入。
- 锁文件重新生成后核对 `resolved` 主机只出现 `registry.npmjs.org`。
- README 中记录的依赖已知问题在 SDK 升级后重新核对，避免过期声明。
