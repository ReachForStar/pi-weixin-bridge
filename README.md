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
- Node.js **18+**
- 已安装并配置好 **pi**（本服务复用 `~/.pi/agent` 下的模型与鉴权配置）

## 安装与运行

### 一键安装（推荐，对标 openclaw-weixin-cli）

```bash
npx -y pi-weixin-bridge install
# 也可从 git 源安装（含最新未发布改动）：
npx -y github:ReachForStar/pi-weixin-bridge install
```

`install` 会依次：① 显示二维码供微信扫码绑定（已有账号则跳过）→ ② 配置 PM2 常驻服务并保存 → ③ 生成隐藏窗口启动/停止快捷方式。

### CLI 命令

```bash
pi-weixin-bridge install     # 一键安装（扫码绑定 + PM2 + 快捷方式）
pi-weixin-bridge login       # 扫码登录 / 重新绑定微信
pi-weixin-bridge start       # 前台运行桥接服务（默认）
pi-weixin-bridge stop        # 停止 PM2 服务
pi-weixin-bridge status      # 查看 PM2 服务状态
pi-weixin-bridge uninstall   # 卸载（删 PM2 服务与快捷方式，保留账号）
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

> npx 方式适合临时运行/测试；长期后台服务仍推荐下面的 PM2 方式（自动重启、日志、开机自启）。

### PM2 常驻部署

> 重要：守护进程无法扫码，须**先交互式登录一次**（`npm start` 扫码，账号落盘），再用 PM2 拉起。

```bash
# 1. 首次交互式登录（扫码后 Ctrl+C 退出即可，账号已保存）
npm start

# 2. PM2 拉起（fork 模式，免构建直接跑 TS）
npm run pm2:start
npm run pm2:save        # 保存进程列表，pm2 守护进程重启后自动恢复

# 常用运维
npm run pm2:logs        # 查看日志
npm run pm2:restart     # 重启
npm run pm2:stop        # 停止
```

会话过期（errcode -14）需重新扫码时：`npm run pm2:stop` → `npm start` 扫码 → `npm run pm2:start`。

### 隐藏窗口启动（不弹终端框，PowerShell）

PM2 守护进程与应用进程均带 `windowsHide`，本身不弹窗；启动时弹出的终端框来自运行启动命令的窗口。用 PowerShell 隐藏启动可全程无可见窗口：

```powershell
# 1. 生成“双击无窗口”快捷方式（只需运行一次）
powershell -NoProfile -ExecutionPolicy Bypass -File create-shortcuts.ps1

# 2. 之后双击生成的快捷方式即可（无终端框）：
#    start-pi-weixin-bridge.lnk  → 后台启动
#    stop-pi-weixin-bridge.lnk   → 停止
```

也可直接命令行隐藏启动：

```powershell
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File start-service.ps1
```

脚本说明：`start-service.ps1` / `stop-service.ps1` 以 `Start-Process -WindowStyle Hidden` 拉起 PM2；`create-shortcuts.ps1` 生成以 `powershell -WindowStyle Hidden` 运行上述脚本的快捷方式（`.lnk` 为本机生成，已 gitignore）。

开机自启：把 `start-pi-weixin-bridge.lnk` 放入启动目录（`shell:startup`）或用任务计划程序；Windows 服务方式可用 `pm2-windows-startup`（`npm i -g pm2-windows-startup && pm2-startup install`）。

## 配置

通过环境变量覆盖默认配置：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PI_WEIXIN_STATE_DIR` | `~/.pi-weixin-bridge` | 状态目录（账号凭据、工作区） |
| `PI_WEIXIN_WORKSPACE` | `D:\pi_weixin_project` | pi 会话的工作目录（Agent 在此读写文件） |

## 项目结构

```
src/
├── index.ts          # 入口：登录、状态持久化、会话超时/鉴权失效重登、优雅退出
├── cli.ts            # CLI 命令（install/login/start/stop/status/uninstall/help）
├── account.ts        # 账号凭据读写
├── config.ts         # 协议常量与路径配置
├── bridge.ts         # 主循环：getUpdates → 媒体 → pi → sendMessage，typing 状态
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
- ✅ PM2 常驻部署（fork 模式）
- ⬜ 出站语音（需 silk 编码）、斜杠命令

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

CI：GitHub Actions 在 push / PR 时自动跑 typecheck + test + build（Node 20 / 22）。

## 故障排查

| 现象 | 原因 / 解决 |
|---|---|
| 启动弹 node.exe 控制台框 | 用 PM2 fork 模式 + bin 包装器（已默认）；勿用 tsx CLI 直接拉起（会额外派生无 `windowsHide` 的子进程） |
| 发图片但 pi 说“看不到图” | pi 全局 `images.blockImages` 为 true 会在送入模型前剥离图片；改为 false（`~/.pi/agent/settings.json`） |
| 提示会话过期 / 要求重扫 | errcode -14，运行 `pi-weixin-bridge login` 重新扫码 |
| 消息被重复处理 / 冲突 | 同一微信账号勿多实例同时轮询 getUpdates；确保只有一个服务在跑 |
| gh / npx 网络超时 | github.com 连通性波动，配置代理（`HTTPS_PROXY`）后重试 |

## 许可

[MIT](./LICENSE)。本项目的 iLink 协议客户端（`src/ilink/`）衍生自腾讯开源的 [`Tencent/openclaw-weixin`](https://github.com/Tencent/openclaw-weixin)（MIT 许可，Copyright Tencent），完整归属与原始许可证见 [NOTICE](./NOTICE)。
