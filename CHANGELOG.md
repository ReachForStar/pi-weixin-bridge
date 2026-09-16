# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.6.0] - 2026-09-16

### Added

- `status` 命令 pm2 list 风格表格：supervisor / 桥接两行的 id、name、mode、重启次数、状态、CPU%（两次采样差值）、内存、运行时长；未运行时显示 offline 表格；重启次数由 supervisor 持久化（每次启动归零、崩溃重启递增）。

## [1.5.3] - 2026-09-16

### Fixed

- 文件/视频接收：CDN 下载增加超时（120s）与重试（3 次递增退避）——瞬断（如 undici terminated）自动重拉；4xx（签名/参数错误）不重试；下载失败日志带重试轨迹。

## [1.5.2] - 2026-09-16

### Changed

- `update` 命令重写：全局安装（`npm i -g`）从 **npm registry** 拉取最新版（`npm install -g pi-weixin-bridge@latest`）并重启 daemon；git 安装走 pull + install + 重启；npx 临时安装提示重跑 `npx -y pi-weixin-bridge install`（npm registry，不再指向 GitHub 仓库）。

## [1.5.1] - 2026-09-16

### Fixed

- package.json 中重复的 `engines` 字段（头部新加 `>=22`、尾部遗留 `>=18`，JSON 后值覆盖前值）导致 npm 发布包声明为旧值；已去重，正确声明 `node >=22`。

## [1.5.0] - 2026-09-16

### Added
- **模型命令**：`/model` 查看当前模型、`/model <provider/modelId>` 切换（应用到所有进行中会话并保存为默认，重启后保持）、`/model list` 列出可用模型（只列 models.json 注册的 provider，避免内置目录上千个模型淹没）；默认模型 `amax/qwen-3.8-27B`，可用 `PI_WEIXIN_MODEL` 环境变量覆盖；未注册的模型引用回退 pi 默认模型（不阻塞服务启动）。
- **斜杠命令完善**（共 9 个）：`/help`（markdown 样式）、`/status`（版本 / 模型 / 工作目录 / 运行时长 / 会话数）、`/new`、`/model`、`/usage`（当前对话消息 / Token / 成本 / 上下文占用）、`/stop`（中断进行中的任务）、`/ping`。
- **skill / MCP 命令**：`/skill`（列出 agentDir + ~/.agents/skills 的 skill 与说明）、`/skill <名称>`（下一条消息按该 skill 处理，pi 先读 SKILL.md 执行）；`/mcp`（列出 mcp.json 的 server）、`/mcp <名称>`（下一条消息调用该 server 工具）。实现为一次性指令（per 会话，消费一次即清除）。
- **回复 markdown 化**：所有命令输出改为 markdown 列表格式——微信 PC 端按 markdown 渲染文本，单 `\n` 被折成空格（之前 /status 显示成一行），列表项才是硬换行。
- 安装向导：`install` 交互式选择保存路径（状态目录 / pi 工作目录，回车默认、`--yes` 非交互）；结果写入 `~/.pi-weixin-bridge/config.json`，后续所有进程（含 daemon 子进程）自动生效。
- 配置三级解析：环境变量 > config.json > 平台默认；pi 工作目录默认按平台区分（Windows `D:\pi_weixin_project`，其他 `~/pi-weixin-project`）。
- 凭据权限加固：POSIX 下状态目录自动收紧 700、账号文件 600（不受 umask 影响）；目录选择前实际探针校验可写。
- 跨平台支持（Linux / macOS）：daemon 杀进程树按平台适配；Linux `daemon install-boot` 注册 systemd 用户服务（免 root，附 linger 提示）；快捷方式步骤仅 Windows。
- `runInstallWizard` 支持注入输入流与显式 interactive 覆盖；行读取器缓存快速管道输入（不丢答案），EOF 优雅回退默认。

### Changed
- **Node 版本要求提升为 22+**：pi-coding-agent SDK 及其内置 undici 在 Node 20 下导入即崩（`webidl.markAsUncloneable is not a function`）；CI 矩阵改为仅 Node 22，package.json 增加 `engines.node >=22`。
- `install` 流程调整为四步（选路径 → 扫码 → daemon → 快捷方式）；路径非默认时带 env 重执行自身，保证登录/daemon 子进程生效新路径。
- `waitForAccountChange` 与 supervisor 退避等待均可被信号打断（SIGTERM 后无需睡满轮询/退避窗口）。
- 退出信号导致的重登等待中断不再记为“致命错误”。

### Fixed
- 未登录场景下状态目录权限不收紧（此前仅 saveState 执行后才收紧）。

## [1.4.0] - 2026-09-16

### Added
- 内置后台 daemon 管理器（`src/daemon/`，零第三方依赖，替代 PM2 硬依赖）：`daemon start/stop/status/restart/logs`。supervisor 进程崩溃自动重启（指数退避 3s→60s 封顶、存活超 60s 重置），PID/日志落在 `~/.pi-weixin-bridge/daemon/`（npx 临时目录被清理不受影响），日志超 5MB 自动轮转。
- 开机自启：`daemon install-boot / uninstall-boot`（每用户登录计划任务，免管理员、隐藏窗口）。
- 后台重登（headless）：后台模式下会话过期不再阻塞在 stdin 等待扫码，日志提示在终端运行 `login` 重新扫码，`account.json` 更新后服务自动恢复。
- 新增 `start`/`status` 等命令兼容（原仅 pm2 路径）。

### Changed
- `install` / `stop` / `status` / `update` / `uninstall` 从 PM2 切换为内置 daemon；PM2 降级为可选路径（`npm run pm2:*` 仍可用）。
- 快捷方式脚本（start/stop-service.ps1）改调 `daemon start/stop`。
- npm 包分发新增 `scripts/` 与 `*.ps1`（开机自启脚本随包发布）。

## [1.3.1] - 2026-07-26

### Added
- `update` 命令：更新到最新版（git 安装走 git pull + npm install + pm2 restart；npx 安装提示重跑安装命令）。

## [1.3.0] - 2026-07-26

### Added
- 斜杠命令（`src/command.ts`）：`/help`（帮助）、`/status`（状态）、`/new`（新对话，清空会话上下文）；未知斜杠命令交由 pi 处理。
- `PiSessionManager.resetSession`（供 /new 重置会话）。
- 斜杠命令单元测试。

## [1.2.0] - 2026-07-26

### Added
- context_token / typing ticket 持久化（`ContextStore`，重启可恢复，支持主动推送）。
- 分级日志（`src/logger/`，info/warn/error/debug + ISO 时间戳，`LOG_LEVEL` 控制）。
- 错误类型分类（`src/ilink/errors.ts`：Network/Auth/Protocol/SessionTimeout），鉴权失效（401/403）自动触发重登。
- 出站媒体：泛型 `uploadMedia` + 文件/视频上传，`builder` 新增文件/视频消息构造。
- markdown 辅助（`src/message/markdown.ts`：格式化/转义/长文本分块），回复超长自动分块发送。
- 消息构造/解析模块化（`src/message/builder.ts` + `parser.ts`）。
- 文档：`docs/architecture.md`、`docs/protocol.md`；示例 `examples/echo-bot.ts`。
- 新增模块单元测试（parser/builder/markdown/context-store）。

## [1.1.0] - 2026-07-26

### Added
- 新增 NOTICE 文件，补充腾讯 MIT 版权声明（iLink 客户端衍生自 Tencent/openclaw-weixin），满足 MIT 衍生归属要求。

### Changed
- LICENSE 注明衍生关系；NOTICE 纳入 npm 包分发；README 许可章节补充归属说明。

## [1.0.1] - 2026-07-26

> 已发布到 npm：[`pi-weixin-bridge`](https://www.npmjs.com/package/pi-weixin-bridge)，可 `npx -y pi-weixin-bridge install` 一键安装。

### Added
- 微信 ClawBot ↔ pi 桥接服务核心：iLink 协议直连（扫码登录、长轮询收消息、发消息）。
- 入站媒体处理：图片解密转 base64 供 pi 视觉理解，语音用服务端转文字，文件/视频解密落盘。
- 出站图片：pi 经 `send_weixin_image` 工具上传发送本地图片（CDN + AES-128-ECB）。
- 「正在输入」状态提示（getconfig + sendtyping）。
- pi 多会话管理：按微信会话隔离 + 串行化。
- CLI：`install` / `login` / `start` / `stop` / `status` / `uninstall` / `help`，支持 `npx` 一键安装。
- PM2 常驻部署（fork 模式，经 bin 包装器进程内运行 tsx，避免 Windows 启动弹控制台框）。
- 隐藏窗口启动/停止快捷方式生成（PowerShell）。
- 单元测试（vitest：AES 加解密、消息提取、iLink 请求构造）与 GitHub Actions CI。
- 发布流程自动化：push 到 main 测试通过后，自动发布 npm 并从 CHANGELOG 提取 notes 创建 GitHub Release。
- 仓库增加 GitHub topics（wechat / ai-agent / chatbot 等 12 个）。
- 新增 `scripts/extract-changelog.mjs`（CI 提取版本 release notes）。
- 英文版 README（README_en.md），与中文版互加切换链接。

### Changed
- npm 包描述改为中英双语，扩充 keywords，提升可发现性。
