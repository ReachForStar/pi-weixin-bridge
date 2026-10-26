---
title: 合并 PR #3：pi 核心升级到 1.4.0
type: query
tags: [依赖升级, 锁文件, 合并, CI]
created: 2026-10-26
updated: 2026-10-26
sources: []
status: active
---

## 问题

外部贡献者提交的 PR #3 把 `@earendil-works/pi-coding-agent` 从 0.82.0 升到 1.4.0，同时改了 npm 入口查找、`fast-xml-parser` 依赖声明与任务通知行为。GitHub 显示 `mergeable: CONFLICTING`、`mergeStateStatus: DIRTY`，需要判断能否合并、冲突怎么解、哪些改动应排除。

## 根因

冲突完全来自 `package-lock.json` 的源主机，与升级内容无关：

- PR 的锁文件有 117 条 `resolved` 指向 `registry.npmmirror.com`（esbuild、rollup、@firecrawl/anydoc 的各平台包等）。
- main 已在提交「归一化依赖锁文件源主机修复 EALLOWREMOTE」中把全部主机统一为 `registry.npmjs.org`。
- 本机 npm 12.2.0 默认 `allow-remote = none`，用 PR 锁文件实测直接失败：

```
npm error code EALLOWREMOTE
npm error Refusing to fetch ".../https://registry.npmmirror.com/why-is-node-running/..."
```

## 解法

1. 只取 PR 中与升级相关的四个文件：`package.json`、`scripts/ci-run.mjs`、`src/npm-command.ts`、`test/shortcuts.test.ts`。
2. 以 main 的锁文件为基线重新生成：`npm install --package-lock-only`，生成结果 244 条 `resolved` 全部为 `registry.npmjs.org`，安装不再被拒。
3. `engines.node` 由 `>=22` 上调为 `>=22.19.0`（SDK 1.4.0 的实际要求），中英文 README 同步。
4. 排除 PR 中的 `src/message/task-notifier.ts` 与 `test/task-notifier.test.ts`：该改动删除任务开始确认与每 30 秒进度通知，理由是「typing 状态已承担处理中反馈」，但 `src/bridge.ts` 只在任务开始发一次 `TypingStatus.TYPING`、结束发 `CANCEL`，长任务期间输入状态是否持续未验证；同时 `README.md`、`CHANGELOG.md`、`README_en.md`、[对话恢复与任务通知](../entities/conversation-recovery.md)、[后续功能候选](feature-candidates.md) 都记录着开始确认与周期进度，一并改动属于另一个决策。

保留的 PR 内容：

- 升级 1.4.0：桥接引用的 `getAgentDir`、`SessionManager`、`AgentSession`、`DefaultResourceLoader`、`ModelRuntime`、`loadSkillsFromDir` 在 1.4.0 兼容，`tsc` 零改动。
- `npmCommand()` 与 `scripts/ci-run.mjs` 增加 Homebrew 分离 formula 布局候选路径 `<prefix>/Cellar/node/<ver>/bin` → `<prefix>/lib`。
- `fast-xml-parser` 显式声明为 devDependency：1.4.0 依赖树不再携带该包，`test/shortcuts.test.ts` 原先从 pi 核心包位置借用的传递依赖失效。

## 验证

以合并后文件在独立目录执行：

- `npm ci` 通过（190 包）
- `npm run typecheck`、`npm run build` 通过
- `npm test`：155 通过 / 7 跳过，与 main 基线一致
- 1.4.0 的 `dist/core/sdk.js` 仍不触发 `session_start`，`src/pi/sessions.ts` 的 `bindExtensions({})` 补调必须保留（见 [SDK 会话不触发 session_start](sdk-session-start-hooks.md)）

## 涉及模块

`package.json`、`package-lock.json`、`src/npm-command.ts`、`scripts/ci-run.mjs`、`test/shortcuts.test.ts`；关联[供应方读取与会话模型配置](../entities/model-configuration.md)、[Windows macOS Linux 适配](../entities/platform-support.md)、[npm 统一安装与版本分发](../decisions/npm-distribution.md)。

## 复发预防

- 锁文件重新生成后必须核对 `resolved` 主机：`grep -o 'https://registry\.[a-z.]*' package-lock.json | sort | uniq -c` 只应出现 `registry.npmjs.org`。
- 依赖锁文件生成时不要混用镜像源 registry，否则 npm 12 会按异主机远端来源拒绝安装。
- 外部 PR 的 CI：fork 提交的 PR 工作流需要维护者批准才运行，本仓库侧三次运行都是 `action_required` 且无 job，只能采信 fork 内的 push 运行与本地实测。
- 升级 pi 核心后复核 `engines.node` 是否与 SDK 一致，本次 SDK 要求 `>=22.19.0`。
- 外部 PR 若夹带与标题无关的行为变更，单独拆分讨论，不同时合入。
