---
title: 全库审查问题修复
type: query
tags: [审查, 状态持久化, 配置, 定时任务, 登录]
created: 2026-11-09
updated: 2026-11-09
status: active
---

## 问题

用 `ocr scan` 对 65 个代码文件做全库审查，产出 332 条意见（6 critical、60 high、169 medium、97 low）。逐条核对后确认 23 组真实问题，主要集中在状态读取、配置恢复、定时任务、扫码登录与会话生命周期。其余 critical/high 中有一批是误报，已单独记录。

## 根因

- **状态读取把错误当空数据**：`existsSync` 对 EACCES/EMFILE/EISDIR 返回 false，`readJson` 随即返回空值，调用方的读-改-写会用空快照覆盖原文件；损坏文件隔离失败时也继续按空数据运行。
- **结构校验缺失**：任务记录、资料、定时任务、用量、项目偏好与账号凭据只校验了部分字段（或完全没校验），合法 JSON 但形状不符时在下游抛 TypeError，功能或整个服务不可用。
- **配置入口被自己的校验阻断**：`config.json` 在模块加载期校验失败会抛错，所有 CLI 命令（包括修复入口）都无法启动。
- **定时任务把用户中止当失败**：`/stop` 只中止 per-task 信号，桥接级信号未中止，失败通知与 `enabled=false` 被误触发；`finally` 中 cron 解析抛错还会跳过 `active` 清理与状态保存。
- **会话创建窗口不可见**：`busy` 在 `getOrCreate()` 之后才置位，`/stop`、模型切换与配置修改在创建期间误判为空闲；`/sessions` 通过会自愈索引的 `open()` 读取当前会话，可能改写指针。
- **登录与 HTTP 错误处理**：动态 import 期间到达的退出信号无法被 `readLine` 监听；配对码输入不受登录总超时约束；扫码轮询把鉴权/网络错误吞成 `wait`；响应 `ret` 只在 `sendMessage` 校验。
- **其他边界**：附件上限被配置直接覆盖、非 JSON 响应抛原生错误、模型无文本回复发两条结束语、`/project` 清空 `/model` 选择、macOS 进程启动时间受时区影响、Windows supervisor 停止失败无重试、安装向导探针跟随符号链接、测试清理脚本按当前目录定位 `tmp/`、上下文令牌每条消息同步 fsync。

## 解法

- `src/features/state.ts`：直接读取文件，只把 ENOENT 当空；隔离失败抛出并中止本次读改写。任务、资料、定时、用量、偏好与账号补结构校验。
- `src/config.ts`：模块加载期保留可解析的 `stateDir`/`workspace`/`model` 与 `CONFIG_ERROR`；`loadSettings()` 仍拒绝使用无效配置，`main()` 与 `daemon start` 明确失败；`saveSettings()` 增加 3 秒跨进程写锁与 10 秒陈旧锁回收。
- `src/features/scheduler.ts`：新增 `JobCancelledError`；用户停止只标记 interrupted，周期任务推进到下一次；`finally` 先释放 active，cron 解析与保存分别兜底。
- `src/pi/sessions.ts`、`conversation-store.ts`：`busy` 在会话创建前置位并在失败时清理；新增只读 `peek()` 供 `/sessions` 使用。
- `src/ilink/login.ts`、`client.ts`：动态 import 后补信号检查；配对码输入受剩余登录时间约束并拒绝空值；统一 JSON 解析错误，扫码轮询只把内部超时当 `wait`，`getConfig`/`sendTyping`/`getUploadUrl` 校验 `ret`。
- `src/ilink/media.ts`：生效上限取 `maxFileBytes` 与 64MiB 的较小值，文件与视频超限也抛 `MediaTooLargeError`。
- `src/bridge.ts`：空回复标记已回复，避免双结束语；定时任务把 per-task 中止转换为 `JobCancelledError`，不发失败通知。
- `src/features/policy.ts`：切换项目保留已选模型；偏好文件补结构校验。
- 进程与安装：macOS 采集启动时间固定 `TZ=UTC`；Windows supervisor 强杀失败每 2 秒重试；安装向导使用随机独占探针并拒绝状态目录与工作目录重叠。
- 工程：`clean-tmp.mjs` 按脚本位置定位 `tmp/` 并拒绝符号链接；npm 令牌检查校验到期日、区分鉴权失败与网络故障；`ContextStore` 250ms 合并写入并在桥接退出时 flush。

## 涉及模块

`src/features/`、`src/config.ts`、`src/ilink/`、`src/pi/`、`src/message/documents.ts`、`src/bridge.ts`、`src/daemon/`、`src/wizard.ts`、`scripts/clean-tmp.mjs`、`.github/workflows/npm-token-check.yml`。

## 复发预防

- 状态类新增字段时同步更新 `readJson` 的 `isValid`，并用「合法 JSON 但形状不符」用例覆盖降级路径。
- 定时任务的中止与失败必须区分错误类型，不能只看 `enabled` 或通用 catch。
- 任何会阻塞输入的等待都必须接受 `AbortSignal`，并在注册监听后补一次已中止检查。
- 验证：typecheck、build 通过，187 项测试通过、7 项按平台跳过。测试覆盖形状不符降级、非 ENOENT 读取错误、定时任务中止/非法 cron、HTTP 非 JSON 与非零 ret、登录重叠目录、上下文合并写入。OCR 默认排除 `test/`，测试代码未参与全库扫描。

误报记录：`/file` 已通过 `ctx.sendFile` 走 `Features.filePath` 校验；GitHub Actions 权限推断与最近成功运行不符；Windows 无 SIGTERM 语义；进程锁回收交错在 `wx` 与存活校验下不成立；`reset()` 的 `wx` 使用新 UUID 文件；未知异常由 supervisor 重启是现有设计。

关联：[桥接运行可靠性](../entities/bridge-reliability.md)、[后台守护进程](../entities/background-daemon.md)、[对话恢复与任务通知](../entities/conversation-recovery.md)、[微信功能服务与权限](../entities/feature-services.md)。
