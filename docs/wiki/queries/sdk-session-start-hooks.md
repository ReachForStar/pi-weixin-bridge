---
title: SDK 会话不触发 session_start 导致用户 hooks 不生效
type: query
tags: [pi-sdk, extensions, hooks, 桥接]
created: 2026-10-26
updated: 2026-10-26
sources: []
status: active
---

## 问题

微信桥接（`createAgentSession`）里，用户 `~/.pi/agent/extensions/` 下的部分 hooks 不生效：
wiki-memory 不注入知识库导航、task-flow 不注入清单约定、tmp-guard 不建 tmp 快照、
safe-guard 的每会话状态不重置。同样的扩展在交互式 pi CLI 里正常。

## 根因

扩展**加载**没有问题（`extensionsResult` 里 hook 全部注册、无加载错误），缺的是**事件**：

- `AgentSession` 构造函数只调用 `_bindExtensionCore` 绑定 core API，**不 emit `session_start`**。
- `session_start` 只在公开方法 `bindExtensions(bindings)` 里 emit，
  该方法在 `agent-session.js` 中先 `_applyExtensionBindings`，再
  `emit(this._sessionStartEvent)` 与 `extendResourcesFromExtensions`。
- 交互式 CLI 为绑定 uiContext 等会调用 `bindExtensions`；SDK 的 `createAgentSession`
  流程从不调用它，因此 `session_start` 永不触发。

订阅 `before_agent_start`、`tool_call`、`tool_result` 的逻辑在 SDK 会话中正常，
只有订阅 `session_start` 的部分（wiki-memory 建摘要、task-flow 重置与 wikiEnabled、
tmp-guard 建快照、safe-guard 重置计数）不执行。

## 解法

`src/pi/sessions.ts` 的 `getOrCreate()` 在 `createAgentSession` 之后补调：

```ts
// SDK 的 createAgentSession 不触发 session_start（只有交互式 CLI 的 bindExtensions 会），
// 不调它 wiki-memory/safe-guard/task-flow 等订阅 session_start 的 hook 永远不生效
await created.bindExtensions({});
```

`ExtensionBindings` 全字段可选，空对象只触发 `session_start`（reason `startup`）与
`resources_discover`，不改变 UI 或命令上下文。

## 涉及模块

`src/pi/sessions.ts`（PiSessionManager.getOrCreate）；SDK
`@earendil-works/pi-coding-agent` 的 `dist/core/sdk.js` 与 `dist/core/agent-session.js`。
关联[微信功能服务与权限](../entities/feature-services.md)。

## 复发预防

- 升级 pi-coding-agent 后复核 `dist/core/sdk.js` 是否开始自动调用 `bindExtensions`。
  若已自动调用，必须移除桥接层的补调，否则 `session_start` 重复触发会重置
  safe-guard 计数（当前无实际危害，但语义错误）。
- 升级后按注入结果核对：会话结束后导出 jsonl，检查是否出现
  `customType` 为 `wiki-memory`、`tmp-guard` 的注入消息。task-flow 对短 prompt
  不注入属其正常门控（非任务句式且正文过短时跳过），不能据此判定失效。
- `dispose()` 不 emit `session_shutdown`，只有 `reload()` 会 emit。因此 tmp-guard
  的过期状态由下次 `session_start` 兜底清理，桥接层不需要额外补发。
