# 架构

pi-weixin-bridge 把 **pi**（编码 Agent）接入**微信 ClawBot**，直连腾讯 iLink 协议，pi 经 SDK 同进程接入。

## 数据流

```
微信 App（ClawBot）
      │  iLink 协议（HTTPS, ilinkai.weixin.qq.com）
      ▼
┌─────────────────────────────────────────────┐
│  IlinkClient（src/ilink/client.ts）           │
│  长轮询 getUpdates 收消息 / sendMessage 发消息  │
└─────────────────────────────────────────────┘
      │  入站消息
      ▼
┌─────────────────────────────────────────────┐
│  Bridge（src/bridge.ts）主循环                 │
│  ① parseIncomingMessage 解析入站消息           │
│  ② downloadInboundMedia 下载解密媒体           │
│  ③ ContextStore 持久化 context_token          │
│  ④ sendTyping「正在输入」                      │
│  ⑤ 交给 pi 处理 → 回复                        │
│  ⑥ buildTextMessage/buildImageMessage 构造回复 │
└─────────────────────────────────────────────┘
      │  prompt + 图片
      ▼
┌─────────────────────────────────────────────┐
│  PiSessionManager（src/pi/sessions.ts）       │
│  按微信会话隔离的 pi AgentSession + 串行化      │
│  pi 经 send_weixin_image 工具回发图片          │
└─────────────────────────────────────────────┘
```

## 模块职责

| 模块 | 职责 |
|---|---|
| `src/index.ts` | 入口：登录、状态持久化、会话超时/鉴权失效自动重登、优雅退出 |
| `src/bridge.ts` | 主循环：收消息 → 媒体 → pi → 回复 |
| `src/cli.ts` | CLI 命令（install/login/start/stop/status/uninstall） |
| `src/config.ts` | 协议常量与路径配置 |
| `src/account.ts` | 账号凭据读写 |
| `src/logger/` | 分级日志（debug/info/warn/error + 时间戳） |
| `src/ilink/client.ts` | iLink HTTP 客户端（请求头、长轮询、收发、typed errors） |
| `src/ilink/errors.ts` | 错误类型（Network/Auth/Protocol/SessionTimeout） |
| `src/ilink/login.ts` | 扫码登录（重定向、配对码、过期刷新） |
| `src/ilink/context-store.ts` | context_token / typing ticket 持久化 |
| `src/ilink/media.ts` | AES 加解密、CDN 上传下载、入站解析、出站媒体上传 |
| `src/message/parser.ts` | 入站消息解析 |
| `src/message/builder.ts` | 出站消息构造（文本/图片/文件/视频） |
| `src/message/markdown.ts` | markdown 格式化 / 转义 / 分块 |
| `src/pi/sessions.ts` | pi 会话管理（隔离 + 串行化 + 发图工具） |

## 关键设计

### context_token 生命周期
- 每条入站消息携带 `context_token`，回复须原样带回。
- `ContextStore` 按用户持久化 `context_token` 与 typing ticket（`~/.pi-weixin-bridge/context.json`），重启可恢复，支持主动推送。
- typing ticket 带 TTL，过期后重新 `getconfig` 获取。

### 错误处理与自动重登
- 错误分类：`NetworkError`（可重试）、`AuthError`（鉴权失效）、`ProtocolError`（协议/API 错误）。
- `errcode -14`（会话超时）或 `AuthError`（401/403）→ 触发重新扫码登录。
- 网络错误指数退避重试（连续 5 次失败后 30s 退避）。

### 媒体处理
- 入站：图片解密转 base64 供 pi 视觉；语音用服务端转文字；文件/视频解密落盘。
- 出站：图片/文件/视频经 CDN 上传（AES-128-ECB 加密）后构造消息发送。
- AES key 解析兼容两种编码：16 原始字节（图片）或 32 位 hex 字符串（文件/语音/视频）。

### 长文本分块
- 回复经 `chunkText` 按段落分块（默认 4000 字符），避免超出微信单条消息长度限制。
