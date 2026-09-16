# pi-weixin-bridge

[![CI](https://github.com/ReachForStar/pi-weixin-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/ReachForStar/pi-weixin-bridge/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pi-weixin-bridge.svg)](https://www.npmjs.com/package/pi-weixin-bridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933.svg)](https://nodejs.org)

**中文** | [English](./README_en.md)

把 **pi**（编码 Agent）接入**微信 ClawBot** 的桥接服务。直连腾讯官方 **iLink 协议**，不依赖 OpenClaw，pi 通过 SDK 同进程接入。

在微信里给 ClawBot 发消息，即由 pi 处理并回复——把 pi 的全部能力（含 skills、工具）带到微信聊天界面。

## 架构

```
微信 App 里的 ClawBot
      ↕  iLink 协议（HTTPS，ilinkai.weixin.qq.com）
┌──────────────────────────────┐
│  pi-weixin-bridge（本服务）     │
│  ① 扫码登录 → bot_token         │
│  ② 长轮询 getUpdates 收消息      │
│  ③ 入站媒体下载解密（图片/文件等） │
│  ④ 消息 + 图片 → pi prompt        │
│  ⑤ pi 回复（文本/发图工具）→ 发回  │
└──────────────────────────────┘
      ↕  同进程调用（SDK）
   pi AgentSession
```

协议参考腾讯官方开源仓库 [`Tencent/openclaw-weixin`](https://github.com/Tencent/openclaw-weixin)（本服务剥离了其中的 OpenClaw 依赖，仅保留 iLink 客户端）。

## 前置条件

- 微信 App **8.0.70+**，且账号已开通 **ClawBot 插件**（设置 → 插件 → 微信ClawBot，官方灰度放量中）
- Node.js **22+**（pi-coding-agent SDK 及其内置 undici 要求 Node 22）
- 已安装并配置好 **pi**（本服务复用 `~/.pi/agent` 下的模型与鉴权配置）

## 安装与运行

### 一键安装（推荐，对标 openclaw-weixin-cli）

```bash
npx -y pi-weixin-bridge install
# 也可从 git 源安装（含最新未发布改动）：
npx -y github:ReachForStar/pi-weixin-bridge install
```

`install` 会依次：① 交互式选择保存路径（状态目录 / pi 工作目录，回车用默认，可 `install --yes` 跳过询问）→ ② 显示二维码供微信扫码绑定（已有账号则跳过）→ ③ 启动内置后台 daemon（崩溃自动重启，零第三方依赖）→ ④ 生成隐藏窗口启动/停止快捷方式（仅 Windows）。

路径选择说明：

- **状态目录**：账号凭据、会话上下文、后台日志的存放位置，默认 `~/.pi-weixin-bridge`；选择后写入 `~/.pi-weixin-bridge/config.json`，后续所有进程（含 daemon 子进程）自动生效
- **pi 工作目录**：Agent 读写文件的工作区，Windows 默认 `D:\pi_weixin_project`，Linux 默认 `~/pi-weixin-project`
- 安装时会**实际探针校验两个目录可写**；POSIX 下自动收紧权限（状态目录 `700`、账号文件 `600`，凭据不可被其他用户读取）

### CLI 命令

```bash
pi-weixin-bridge install     # 一键安装（扫码绑定 + 后台 daemon + 快捷方式）
pi-weixin-bridge login       # 扫码登录 / 重新绑定微信
pi-weixin-bridge start       # 前台运行桥接服务（默认）
pi-weixin-bridge stop        # 停止后台 daemon
pi-weixin-bridge status      # 查看后台 daemon 状态（pm2 list 风格表格：重启次数 / CPU / 内存 / 运行时长）
pi-weixin-bridge daemon      # daemon 管理：start/stop/status/restart/logs/install-boot/uninstall-boot
pi-weixin-bridge update      # 更新到最新版（全局安装：npm registry 拉最新 + 重启；git 安装：pull + install + 重启；npx 提示重跑安装命令）
pi-weixin-bridge uninstall   # 卸载（停服务、删自启与快捷方式，保留账号）
pi-weixin-bridge help        # 帮助
```

### 手动安装（clone 源码）

```bash
git clone https://github.com/ReachForStar/pi-weixin-bridge.git
cd pi-weixin-bridge
npm install

# 启动（首次会显示二维码，用微信扫码连接）
npm start
```

首次运行：终端显示二维码 → 用微信扫码 → 确认后连接成功。账号凭据保存到 `~/.pi-weixin-bridge/account.json`，之后重启自动复用，无需重复扫码（会话过期时会自动要求重新扫码）。

### 通过 npx 直接安装/运行

本包已发布到 [npm](https://www.npmjs.com/package/pi-weixin-bridge)，带 `bin` 入口（经 `tsx/esm/api` 运行 TS 源码，免构建），可用 npx 直接跑：

```bash
# 从 npm 直接运行（首次同样需扫码登录）
npx -y pi-weixin-bridge

# 或全局安装后用命令运行
npm install -g pi-weixin-bridge
pi-weixin-bridge

# 也可从 git 源运行（含最新未发布改动）
npx -y github:ReachForStar/pi-weixin-bridge
```

> npx 方式适合临时运行/测试；长期后台服务仍推荐下面的 daemon 方式（自动重启、日志、开机自启）。

### 后台 daemon 常驻部署（内置，默认推荐）

> 重要：后台进程无法扫码，须**先交互式登录一次**（`npm start` 扫码，账号落盘），再启动 daemon。

```bash
# 1. 首次交互式登录（扫码后 Ctrl+C 退出即可，账号已保存）
npm start

# 2. 启动后台 daemon（supervisor 常驻：崩溃自动重启、指数退避、日志轮转）
pi-weixin-bridge daemon start
pi-weixin-bridge daemon status    # 查看状态（pm2 list 风格表格）
pi-weixin-bridge daemon logs      # 查看日志（末尾 50 行）
pi-weixin-bridge daemon restart   # 重启
pi-weixin-bridge daemon stop      # 停止
```

内置 daemon 零第三方依赖，PID/日志落在 `~/.pi-weixin-bridge/daemon/`（npx 临时目录被清理也不受影响），跨平台（Windows/POSIX）。

> **曾用 PM2 运行？** 1.6.0 起不再提供 PM2 配置。先 `pm2 stop pi-weixin-bridge` 停掉旧进程（避免两个实例同时轮询同一账号），再用 `pi-weixin-bridge daemon start` 启动。

**会话过期（errcode -14）重新扫码**：后台模式无法交互扫码，日志会提示：

```
[main] 后台模式无法扫码。请在终端运行 `pi-weixin-bridge login` 重新扫码，扫码完成后服务自动恢复
```

在任意终端跑 `pi-weixin-bridge login` 扫码即可，daemon 检测到账号更新后自动恢复，无需重启服务。

**开机自启（可选）**：

```bash
pi-weixin-bridge daemon install-boot     # 注册每用户登录计划任务（免管理员、隐藏窗口）
pi-weixin-bridge daemon uninstall-boot   # 移除
```

### 隐藏窗口启动（不弹终端框，PowerShell）

daemon 进程本身带 `windowsHide`，无控制台窗口；启动时弹出的终端框来自运行启动命令的窗口。用 PowerShell 隐藏启动可全程无可见窗口：

```powershell
# 1. 生成“双击无窗口”快捷方式（只需运行一次）
powershell -NoProfile -ExecutionPolicy Bypass -File create-shortcuts.ps1

# 2. 之后双击生成的快捷方式即可（无终端框）：
#    start-pi-weixin-bridge.lnk  → 后台启动（daemon start）
#    stop-pi-weixin-bridge.lnk   → 停止（daemon stop）
```

也可直接命令行隐藏启动：

```powershell
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File start-service.ps1
```

脚本说明：`start-service.ps1` / `stop-service.ps1` 以 `Start-Process -WindowStyle Hidden` 调用 `daemon start/stop`；`create-shortcuts.ps1` 生成以 `powershell -WindowStyle Hidden` 运行上述脚本的快捷方式（`.lnk` 为本机生成，已 gitignore）。

### Linux / WSL

本项目跨平台（Windows / Linux / macOS，daemon 杀进程树自动适配平台）。Linux 下同样支持后台 daemon 与会话过期重登（headless），无需扫码即可后台运行。

```bash
git clone https://github.com/ReachForStar/pi-weixin-bridge.git
cd pi-weixin-bridge && npm install
pi-weixin-bridge install --yes   # 非交互安装（全部默认路径）
pi-weixin-bridge login           # 首次扫码（后台进程无法扫码，必须先交互登录一次）
pi-weixin-bridge daemon start    # 后台常驻
```

- 安装向导在非 TTY（如 CI / SSH 无终端）下自动使用默认路径；交互终端则会询问状态目录与工作目录。
- 开机自启用 **systemd 用户服务**（免 root）：
  ```bash
  pi-weixin-bridge daemon install-boot     # 注册并 enable systemd user service
  pi-weixin-bridge daemon uninstall-boot   # 移除
  ```
  如需**未登录也随开机启动**，请管理员执行 `loginctl enable-linger <用户名>`。
- WSL 需启用 systemd（`wsl --update` + 发行版内 systemd 作为 PID 1），否则 `daemon install-boot` 会提示不可用，可手动 `daemon start`。
- 凭据文件在 Linux 下自动收紧为 `600`、状态目录 `700`。
- 注意：WSL 与 Windows 的 `~` 不同，两端账号/状态相互独立，互不干扰。

## 配置

配置解析优先级：**环境变量 > `~/.pi-weixin-bridge/config.json`（安装向导写入）> 平台默认**。

| 变量 | 默认 | 说明 |
|---|---|---|
| `PI_WEIXIN_STATE_DIR` | `~/.pi-weixin-bridge` | 状态目录（账号凭据、会话上下文、daemon 日志） |
| `PI_WEIXIN_WORKSPACE` | Windows `D:\pi_weixin_project` / 其他 `~/pi-weixin-project` | pi 会话的工作目录（Agent 在此读写文件） |

`config.json` 示例（由 `install` 向导生成，可手改）：

```json
{ "stateDir": "D:\\data\\piwx", "workspace": "D:\\pi_weixin_project" }
```

权限：POSIX 下状态目录与账号凭据文件会自动收紧为 `700` / `600`；Windows 依赖用户目录 ACL（默认即仅当前用户可访问）。

## 项目结构

```
src/
├── index.ts          # 入口：登录、状态持久化、会话超时/鉴权失效重登、优雅退出
├── cli.ts            # CLI 命令（install/login/start/stop/status/update/uninstall/help）
├── account.ts        # 账号凭据读写
├── config.ts         # 协议常量与路径配置
├── bridge.ts         # 主循环：getUpdates → 媒体 → pi → sendMessage，typing 状态
├── daemon/           # 内置后台 daemon（零第三方依赖，替代 PM2）
│   ├── daemon.ts     # 控制端：拉起/停止 supervisor 进程树、PID 与日志、退避策略
│   ├── supervisor.ts # supervisor 进程：子进程崩溃自动重启（指数退避）
│   └── boot.ts       # 开机自启：注册/移除每用户登录计划任务（免管理员）
├── logger/           # 分级日志（info/warn/error/debug + 时间戳）
├── ilink/
│   ├── types.ts      # iLink 协议类型与枚举
│   ├── client.ts     # HTTP 客户端（请求头、长轮询、收发、typed errors）
│   ├── errors.ts     # 错误类型（Network/Auth/Protocol/SessionTimeout）
│   ├── login.ts      # 扫码登录流程（含重定向、配对码、过期刷新）
│   ├── context-store.ts # context_token / typing ticket 持久化
│   ├── message.ts    # 消息正文提取（文本 / 语音转文字）
│   └── media.ts      # 媒体：AES 加解密、CDN 上传下载、入站解析、出站媒体上传
├── message/          # 消息构造 / 解析
│   ├── parser.ts     # 入站消息解析
│   ├── builder.ts    # 出站消息构造（文本/图片/文件/视频）
│   └── markdown.ts   # markdown 格式化 / 转义 / 分块
└── pi/
    └── sessions.ts   # pi 会话管理（按微信会话隔离 + 串行化 + 发图工具）
docs/                 # 架构与协议文档
examples/             # 示例（echo-bot）
test/                 # 单元测试（vitest）
```

详细设计见 [docs/architecture.md](docs/architecture.md) 与 [docs/protocol.md](docs/protocol.md)；最小示例见 [examples/echo-bot.ts](examples/echo-bot.ts)。

## iLink 协议要点

- **基地址**：`https://ilinkai.weixin.qq.com`（登录后可能因 IDC 调度切换）
- **请求头**：`AuthorizationType: ilink_bot_token`、`Authorization: Bearer <bot_token>`、`X-WECHAT-UIN`、`iLink-App-Id: bot` 等
- **核心接口**：`get_bot_qrcode` / `get_qrcode_status`（登录）、`getupdates`（长轮询收消息）、`sendmessage`（发消息）、`getconfig` / `sendtyping`（输入状态）、`getuploadurl`（媒体上传）
- **关键机制**：回复须原样带回入站消息的 `context_token`；`getupdates` 用 `get_updates_buf` 做增量同步；`errcode -14` 表示会话超时需重登
- **媒体**：CDN 域名 `https://novac2c.cdn.weixin.qq.com/c2c`，AES-128-ECB 加解密；入站图片解密后转 base64 供 pi 视觉理解，出站图片经 `send_weixin_image` 工具上传发送

## 功能范围

- ✅ 扫码登录 + 凭据持久化 + 会话超时自动重登
- ✅ 文本消息收发（私聊 / 群聊 @）
- ✅ 按微信会话隔离的 pi 多会话 + 串行化
- ✅ 「正在输入」状态提示（getconfig + sendtyping）
- ✅ 入站媒体：图片（解密→pi 视觉）、语音（服务端转文字）、文件/视频（解密落盘→告知路径）
- ✅ 出站媒体：图片/文件/视频经 CDN 上传后发送（`send_weixin_image` 工具 + builder）
- ✅ 长文本分块发送（markdown 分块，避免超出微信单条长度）
- ✅ 分级日志 + 错误分类（网络/鉴权/协议）+ 鉴权失效自动重登
- ✅ context_token / typing ticket 持久化（重启恢复）
- ✅ 斜杠命令（10 个：`/help` / `/status` / `/new` / `/model` / `/skill` / `/mcp` / `/reload` / `/usage` / `/stop` / `/ping`），未知命令交由 pi
- ✅ 内置后台 daemon（崩溃自动重启 + 日志轮转 + 开机自启，零第三方依赖；Windows 计划任务 / Linux systemd 用户服务）
- ✅ 跨平台（Windows / Linux / macOS），安装向导交互式选择保存路径 + 凭据权限加固（POSIX 700/600）
- ⬜ 出站语音（需 silk 编码，未做）

### 模型

- **默认模型** `amax/qwen-3.8-27B`（内置）；`/model <provider/modelId>` 可切换到 `~/.pi/agent/models.json` 中注册的任何模型，选择会保存为默认（重启后保持）；环境变量 `PI_WEIXIN_MODEL` 可覆盖默认值。

### 斜杠命令

| 命令 | 说明 |
|---|---|
| `/help` | 显示帮助 |
| `/status` | 服务状态（版本 / 账号 / 模型 / 工作目录 / 运行时长 / 会话） |
| `/new` | 开始新对话（清空当前会话上下文） |
| `/model` | 查看当前模型 |
| `/model list` | 可用模型列表（只列 models.json 注册的 provider） |
| `/model <provider/modelId>` | 切换模型（应用到所有进行中会话并保存为默认） |
| `/skill` | 可用 skill 列表（含说明） |
| `/skill <名称>` | 下一条消息按该 skill 处理（pi 会先读其 SKILL.md 再执行） |
| `/mcp` | 已配置 MCP server 列表（含启动命令） |
| `/mcp <名称>` | 下一条消息调用该 server 的工具处理 |
| `/reload` | 重载模型配置（models.json 改动立即生效，并重新应用到现有会话） |
| `/usage` | 当前对话用量（消息 / 工具调用 / Token / 成本 / 上下文占用） |
| `/stop` | 停止当前进行中的任务 |
| `/ping` | 服务存活检查 |

> 命令回复统一用 markdown 列表格式（微信端按 markdown 渲染；单换行会被折成空格，列表项才是硬换行）。

## ⚠️ 安全提示

pi 是具备工具执行能力的编码 Agent（默认含 bash 等工具）。接入微信后，**任何能给该 ClawBot 发消息的人，都可能通过对话让 pi 在你的机器上执行命令**。请务必：

- 仅在私聊中使用，不要将 ClawBot 拉入不可信的群聊
- 通过 `PI_WEIXIN_WORKSPACE` 限定 pi 的工作目录，降低误操作影响面
- 如需更严格的权限控制，可在 `src/pi/sessions.ts` 中通过 `createAgentSession` 的 `tools` 选项限制可用工具

## 开发

```bash
npm run typecheck   # 类型检查
npm test            # 单元测试（vitest）
npm run build       # 构建到 dist/
```

CI：GitHub Actions 在 push / PR 时自动跑 typecheck + test + build（Node 22）。

## 故障排查

| 现象 | 原因 / 解决 |
|---|---|
| 启动弹 node.exe 控制台框 | 用内置 daemon（已默认）；勿用 tsx CLI 直接拉起（会额外派生无 `windowsHide` 的子进程） |
| 后台会话过期，收不到消息 | 后台模式无法扫码，日志提示运行 `pi-weixin-bridge login` 重新扫码，扫码后服务自动恢复 |
| 自定义的保存路径不生效 | 路径写入 `~/.pi-weixin-bridge/config.json`（安装向导生成）；运行时环境变量 `PI_WEIXIN_STATE_DIR`/`PI_WEIXIN_WORKSPACE` 优先于 config.json。改完需 `daemon restart` |
| Linux `daemon install-boot` 提示 systemd 不可用 | WSL 未启用 systemd（需 `wsl --update` 且 systemd 为 PID 1）；可手动 `daemon start` 后台运行 |
| 状态目录 / 凭据权限 | POSIX 下状态目录自动 `700`、账号文件 `600`；若目录属主不是当前用户则 chmod 会静默跳过，请检查目录归属 |
| 发图片但 pi 说“看不到图” | pi 全局 `images.blockImages` 为 true 会在送入模型前剥离图片；改为 false（`~/.pi/agent/settings.json`） |
| 提示会话过期 / 要求重扫 | errcode -14，运行 `pi-weixin-bridge login` 重新扫码 |
| 消息被重复处理 / 冲突 | 同一微信账号勿多实例同时轮询 getUpdates；确保只有一个服务在跑 |
| gh / npx 网络超时 | github.com 连通性波动，配置代理（`HTTPS_PROXY`）后重试 |

## 许可

[MIT](./LICENSE)。本项目的 iLink 协议客户端（`src/ilink/`）衍生自腾讯开源的 [`Tencent/openclaw-weixin`](https://github.com/Tencent/openclaw-weixin)（MIT 许可，Copyright Tencent），完整归属与原始许可证见 [NOTICE](./NOTICE)。
