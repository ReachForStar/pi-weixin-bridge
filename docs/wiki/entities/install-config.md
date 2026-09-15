---
title: 安装向导与配置解析
type: entity
tags: [install, wizard, config, 权限, 路径]
created: 2026-09-16
updated: 2026-09-16
sources: []
status: active
---

# 安装向导与配置解析（src/wizard.ts + src/config.ts + src/account.ts）

`install` 命令的路径选择、持久化与权限加固逻辑（v1.5.0 引入）。

## 职责

- **安装向导**（`wizard.ts`，`runInstallWizard`）：
  - 交互（TTY 且未 `--yes`）：逐项询问状态目录 / pi 工作目录，回车用默认；`~` 展开、相对路径转绝对（`resolveUserPath`）
  - 非交互（无 TTY 或 `--yes`）：直接用当前生效值
  - 两个目录**实际探针校验可写**（写删临时文件，而非仅 existsSync）
  - 结果写入 `~/.pi-weixin-bridge/config.json`（引导目录固定，即使状态目录自定义也能被发现）
  - `opts.input` 可注入输入流、`opts.interactive` 可显式覆盖 TTY 检测（测试/特殊场景）
- **配置解析**（`config.ts`）：环境变量 > config.json > 平台默认；`BOOTSTRAP_DIR` 固定 `~/.pi-weixin-bridge`；`defaultWorkspace()` 按平台（win32 `D:\pi_weixin_project`，其他 `~/pi-weixin-project`）
- **权限加固**（`account.ts`，`hardenStateDir` / `saveState`）：POSIX 下状态目录 700、账号文件 600（mkdir 的 mode 受 umask 影响，写入后显式 chmod；非属主等场景静默跳过不阻断）

## 关键设计

- **重执行（re-exec）**：CLI 进程启动时 config 常量已解析完毕，向导选择了非默认路径后，`cli.ts install` 用 `PI_WEIXIN_STATE_DIR`/`PI_WEIXIN_WORKSPACE` env（优先级最高）`spawnSync` 重执行 `install --yes` 再退出——保证后续登录与 daemon 子进程都生效新路径，无需重构 config 为可变。
- **LineReader**（wizard 内部）：缓存先于 `question()` 到达的行——快速管道/pty 输入两行一次性到达时第二行不丢；EOF 时挂起的 question 按空输入结算（回退默认），避免 Ctrl+D 触发 readline AbortError 崩溃。
- config.json 损坏时回退默认不抛错（`loadSettings` try/catch）。

## 上下游依赖

- 上游：`cli.ts`（install 四步流程）
- 下游：所有读 `STATE_DIR`/`WORKSPACE`/`ACCOUNT_FILE` 的模块（account、daemon、bridge、sessions 等）；daemon 子进程经 config.json/env 继承路径

## 重要变更记录

- 2026-09-16（v1.5.0）：新增安装向导、config.json 三级解析、平台默认 workspace、权限加固；修复快速管道输入丢答案与 EOF 崩溃。
