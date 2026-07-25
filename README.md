# pi-weixin-bridge

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
│  ③ 消息 → pi prompt             │
│  ④ pi 回复 → sendMessage 发回    │
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

```bash
git clone https://github.com/MindFlowLab/pi-weixin-bridge.git
cd pi-weixin-bridge
npm install

# 启动（首次会显示二维码，用微信扫码连接）
npm start
```

首次运行：终端显示二维码 → 用微信扫码 → 确认后连接成功。账号凭据保存到 `~/.pi-weixin-bridge/account.json`，之后重启自动复用，无需重复扫码（会话过期时会自动要求重新扫码）。

生产部署可用 PM2 等常驻：

```bash
npm run build
pm2 start dist/index.js --name pi-weixin-bridge
```

## 配置

通过环境变量覆盖默认配置：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PI_WEIXIN_STATE_DIR` | `~/.pi-weixin-bridge` | 状态目录（账号凭据、工作区） |
| `PI_WEIXIN_WORKSPACE` | `<STATE_DIR>/workspace` | pi 会话的工作目录（Agent 在此读写文件） |

## 项目结构

```
src/
├── index.ts          # 入口：登录、状态持久化、会话超时重登、优雅退出
├── config.ts         # 协议常量与路径配置
├── bridge.ts         # 主循环：getUpdates → pi → sendMessage
├── ilink/
│   ├── types.ts      # iLink 协议类型与枚举
│   ├── client.ts     # HTTP 客户端（请求头、长轮询、收发消息）
│   └── login.ts      # 扫码登录流程（含重定向、配对码、过期刷新）
└── pi/
    └── sessions.ts   # pi 会话管理（按微信会话隔离 + 串行化）
```

## iLink 协议要点

- **基地址**：`https://ilinkai.weixin.qq.com`（登录后可能因 IDC 调度切换）
- **请求头**：`AuthorizationType: ilink_bot_token`、`Authorization: Bearer <bot_token>`、`X-WECHAT-UIN`、`iLink-App-Id: bot` 等
- **核心接口**：`get_bot_qrcode` / `get_qrcode_status`（登录）、`getupdates`（长轮询收消息）、`sendmessage`（发消息）
- **关键机制**：回复须原样带回入站消息的 `context_token`；`getupdates` 用 `get_updates_buf` 做增量同步；`errcode -14` 表示会话超时需重登

## 当前范围（MVP）

- ✅ 扫码登录 + 凭据持久化 + 会话超时自动重登
- ✅ 文本消息收发（私聊 / 群聊 @）
- ✅ 按微信会话隔离的 pi 多会话 + 串行化
- ⬜ 「正在输入」状态提示（sendTyping）
- ⬜ 图片 / 语音 / 文件等媒体消息（CDN 上传下载）
- ⬜ 斜杠命令、长文本分段发送

## ⚠️ 安全提示

pi 是具备工具执行能力的编码 Agent（默认含 bash 等工具）。接入微信后，**任何能给该 ClawBot 发消息的人，都可能通过对话让 pi 在你的机器上执行命令**。请务必：

- 仅在私聊中使用，不要将 ClawBot 拉入不可信的群聊
- 通过 `PI_WEIXIN_WORKSPACE` 限定 pi 的工作目录，降低误操作影响面
- 如需更严格的权限控制，可在 `src/pi/sessions.ts` 中通过 `createAgentSession` 的 `tools` 选项限制可用工具

## 许可

MIT
