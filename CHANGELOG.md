# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.7.1] - 2026-10-01

### Added

- 增加 pi-weixin-bridge config：交互配置与 show/get/set/unset/models/model，管理路径、默认模型、访问权限、项目、文件上限和日预算。

### Fixed

- Windows 创建快捷方式直接传递 PowerShell 参数，支持包含空格的 npm 安装路径；脚本异常与非零退出码终止安装，不再错误显示完成。
- 配置写入前统一校验，使用临时文件原子替换；无效模型、权限、预算、时区或项目不改写原配置。
- 修改路径前要求停止后台，显示环境变量覆盖与状态目录不迁移提示；升级后缺失默认模型可直接 config model 配置，无需重新扫码或完整安装。


## [1.7.0] - 2026-09-30

### Added

- 扫码后从 pi models.json 选择供应方及默认模型；/model 会话独立切换并持久保存，完善 CLI 与微信帮助。
- 文件回传、历史会话切换命名与 HTML 导出、附件去重资料库及本地全文检索。
- 白名单、管理员与只读权限、项目工作目录和工具/技能限制、逐项工具执行确认。
- 持久任务记录与消息编号去重、经确认人工重试、支持时区的持久定时任务。
- 扫描 PDF 逐文件确认云端 OCR，保存受支持办公文档内嵌图片；按日用量预算与只读诊断。

- 固定依赖 anydoc 0.2.4，入站 PDF 与受支持办公文档本地转换为 Markdown，保留原件并将转换结果交给 pi；扫描 PDF 提示需 OCR，不自动上传。

- 按账号、工作目录和微信对话保存 pi 会话，重启后恢复上下文；/new 持久切换新对话并保留历史记录。
- 任务开始确认、长任务每 30 秒进度、任务失败与停止通知；通知仅包含阶段和耗时，不包含工具参数或原始错误。

### Changed

- 用户安装和更新统一从 npm 获取，全局安装后运行 install；移除 GitHub 源安装、npx 安装和 Git 拉取更新入口，GitHub 保存源码与 CI。

- 发布流程仅在 main 推送前后版本号变化且检查通过时执行；发布前由维护者确认版本修改与推送，npm 已发布时可补建 Release，Release 指向本次检查的提交。
- 将本地知识库纳入版本管理。

### Fixed

- 后台异步等待就绪、独占实例与 supervisor 进程锁、停止长运行子进程、关闭日志描述符，区分等待扫码与运行状态。
- Windows 自启使用绝对可执行路径、保留安装参数并传播启动退出码；Linux unit 保存路径并配置 ExecStop。
- /reload 保留会话模型选择，历史会话列表展示完整 UUID，拒绝损坏访问配置。
- 文件与图片上传支持任务取消和 120 秒超时。

- 入站文件名移除目录分隔符与非法字符，随机前缀和独占写入防止路径逃逸及并发覆盖。

- 串行队列中图片回复上下文按实际执行任务绑定，避免后续排队消息覆盖前一个任务的回复目标；/new 与对话共用队列，避免重置竞态。

- 桥接轮询退避可被退出信号中断；后台重登等待不再累积退出监听器。
- HTTP 超时覆盖响应正文读取，已中断的请求不再继续发送，正文网络错误按网络错误分类。
- 文本分块拒绝非法长度，硬切时保持 Unicode 代理对完整。

## [1.6.1] - 2026-09-16

### Changed

- **PM2 移除**：内置 daemon 成为唯一后台常驻方案；删除 `ecosystem.config.cjs`、`pm2` 开发依赖与 `npm run pm2:*` 脚本。曾用 PM2 运行请先 `pm2 stop pi-weixin-bridge` 再 `daemon start`（避免两实例同轮询一账号）。
- CI 加固：job 最小权限 `permissions` + `timeout-minutes` + `concurrency`（同分支串行、不中断进行中的发布）；Release 步骤版本号经 `env` 传入（防表达式注入）且幂等（npm 已发但 Release 创建失败时重跑可补建）。

### Fixed

- 斜杠命令抛错时回复“⚠️ 命令执行失败：…”（此前静默吞错无反馈）；MCP 列表加 100 条上限。
- `/usage` 在模型服务未返回 usage（tokens 全 0 但有助手消息，如部分 OpenAI 兼容代理/自建 vllm）时提示“未返回用量数据”，不再让 0 值看起来像统计故障。
- `account.json` 原子写（tmp+rename，进程中途被杀不损坏）；读取/解析失败打 warn（不再静默视为未登录）。
- skill 目录逐个 try/catch（单目录坏文件不拖垮列表）；mcp.json 损坏打 warn。
- `bin` 入口、`extract-changelog.mjs`（正则转义/CWD 无关/段落缺失报错）、PowerShell 脚本（启动/快捷方式/自启守卫与参数校验）、`.gitignore`（`.env*`/密钥证书类）健壮性加固。
- `main` 字段指向包内真实存在的 `src/index.ts`（CLI 包经 bin 运行，不经 main）。

## [1.6.0] - 2026-09-16

### Added

- `status` 命令 pm2 list 风格表格：supervisor / 桥接两行的 id、name、mode、重启次数、状态、CPU%（两次采样差值）、内存、运行时长；未运行时显示 offline 表格；重启次数由 supervisor 持久化（每次启动归零、崩溃重启递增）。
- `/reload` 斜杠命令：重载模型运行时配置（`ModelRuntime.refresh()` 只读本地 models.json，不走网络），并把当前模型重新应用到所有现有会话；models.json 改动无需重启服务。
- **修复** bridge 会话中用户 hooks（wiki-memory/safe-guard/task-flow/tmp-guard 等订阅 `session_start` 的扩展）不生效：SDK 的 `createAgentSession` 不会触发 `session_start` 事件（仅交互式 CLI 的 `bindExtensions` 会），会话创建后补调 `session.bindExtensions({})`。

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
