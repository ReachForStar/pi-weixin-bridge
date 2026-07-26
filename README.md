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

```bash
git clone https://github.com/MindFlowLab/pi-weixin-bridge.git
cd pi-weixin-bridge
npm install

# 启动（首次会显示二维码，用微信扫码连接）
npm start
```

首次运行：终端显示二维码 → 用微信扫码 → 确认后连接成功。账号凭据保存到 `~/.pi-weixin-bridge/account.json`，之后重启自动复用，无需重复扫码（会话过期时会自动要求重新扫码）。

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

### 隐藏窗口启动（不弹终端框）

PM2 守护进程与应用进程均带 `windowsHide`，本身不弹窗；启动时弹出的终端框来自运行启动命令的窗口。用 VBS 隐藏启动可全程无可见窗口：

- 双击 `start-service.vbs` → 后台启动（无终端框）
- 双击 `stop-service.vbs` → 停止

> VBS 必须为纯 ASCII（不能含中文注释），否则 VBScript 按 GBK 解析 UTF-8 会报 800A01A8。

开机自启：把 `start-service.vbs` 的快捷方式放入启动目录（`shell:startup`）或用任务计划程序。Windows 服务方式可用 `pm2-windows-startup`（`npm i -g pm2-windows-startup && pm2-startup install`）。

## 配置

通过环境变量覆盖默认配置：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PI_WEIXIN_STATE_DIR` | `~/.pi-weixin-bridge` | 状态目录（账号凭据、工作区） |
| `PI_WEIXIN_WORKSPACE` | `D:\pi_weixin_project` | pi 会话的工作目录（Agent 在此读写文件） |

## 项目结构

```
src/
├── index.ts          # 入口：登录、状态持久化、会话超时重登、优雅退出
├── config.ts         # 协议常量与路径配置
├── bridge.ts         # 主循环：getUpdates → 媒体 → pi → sendMessage，typing 状态
├── ilink/
│   ├── types.ts      # iLink 协议类型与枚举
│   ├── client.ts     # HTTP 客户端（请求头、长轮询、收发、getconfig/sendtyping/getuploadurl）
│   ├── login.ts      # 扫码登录流程（含重定向、配对码、过期刷新）
│   └── media.ts      # 媒体：AES 加解密、CDN 上传下载、入站解析、出站图片上传
└── pi/
    └── sessions.ts   # pi 会话管理（按微信会话隔离 + 串行化 + 发图工具）
```

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
- ✅ 出站图片：pi 调用 `send_weixin_image` 工具上传发送本地图片
- ✅ PM2 常驻部署（fork 模式）
- ⬜ 出站语音/文件/视频、斜杠命令、长文本分段发送

## ⚠️ 安全提示

pi 是具备工具执行能力的编码 Agent（默认含 bash 等工具）。接入微信后，**任何能给该 ClawBot 发消息的人，都可能通过对话让 pi 在你的机器上执行命令**。请务必：

- 仅在私聊中使用，不要将 ClawBot 拉入不可信的群聊
- 通过 `PI_WEIXIN_WORKSPACE` 限定 pi 的工作目录，降低误操作影响面
- 如需更严格的权限控制，可在 `src/pi/sessions.ts` 中通过 `createAgentSession` 的 `tools` 选项限制可用工具

## 许可

MIT
