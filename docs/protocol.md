# iLink 协议

微信 ClawBot 使用的 iLink 协议要点（基于腾讯开源 [`Tencent/openclaw-weixin`](https://github.com/Tencent/openclaw-weixin)，MIT 许可）。

## 基地址与请求头

- **基地址**：`https://ilinkai.weixin.qq.com`（登录后可能因 IDC 调度切换，以登录返回的 `baseurl` 为准）
- **CDN 域名**：`https://novac2c.cdn.weixin.qq.com/c2c`

**POST 请求头**：
```
Content-Type: application/json
AuthorizationType: ilink_bot_token
Authorization: Bearer <bot_token>
X-WECHAT-UIN: base64(随机 uint32 的十进制字符串)
iLink-App-Id: bot
iLink-App-ClientVersion: <版本号编码>
```

> GET 请求（如扫码状态轮询）仅用 `iLink-App-Id` / `iLink-App-ClientVersion` 公共头。

## 核心接口

| 接口 | 方法 | 用途 |
|---|---|---|
| `ilink/bot/get_bot_qrcode?bot_type=3` | POST | 获取登录二维码 |
| `ilink/bot/get_qrcode_status?qrcode=<id>` | GET | 长轮询扫码状态 |
| `ilink/bot/getupdates` | POST | 长轮询收取消息 |
| `ilink/bot/sendmessage` | POST | 发送消息 |
| `ilink/bot/getconfig` | POST | 获取 typing_ticket |
| `ilink/bot/sendtyping` | POST | 发送「正在输入」状态 |
| `ilink/bot/getuploadurl` | POST | 获取 CDN 上传预签名 URL |

## 登录流程

1. `get_bot_qrcode` → 返回 `qrcode`（轮询用）与 `qrcode_img_content`（二维码链接）。
2. 长轮询 `get_qrcode_status`，状态机：
   - `wait`：等待扫码
   - `scaned`：已扫码，等待确认
   - `scaned_but_redirect`：IDC 重定向，切换 `redirect_host` 继续轮询
   - `need_verifycode`：需输入配对码
   - `confirmed`：确认成功，返回 `bot_token` / `ilink_bot_id` / `baseurl`
   - `expired`：二维码过期，重新获取

## 消息收发

### 收取（getUpdates）
- 请求体：`{ get_updates_buf, base_info }`。`get_updates_buf` 为上次返回的游标（首次为空），用于增量同步。
- 响应：`{ ret, errcode, msgs[], get_updates_buf, longpolling_timeout_ms }`。
- **`errcode -14` 表示会话超时，需重新登录。**

### 发送（sendmessage）
- 请求体：`{ msg, base_info }`。
- `msg` 关键字段：`to_user_id`、`client_id`（去重用）、`message_type`（BOT=2）、`message_state`（FINISH=2）、`item_list`、`context_token`。
- **回复必须原样带回入站消息的 `context_token`**，否则消息无法归属正确会话。

## 消息项类型（item_list）

| type | 类型 | 字段 |
|---|---|---|
| 1 | 文本 | `text_item.text` |
| 2 | 图片 | `image_item.media` |
| 3 | 语音 | `voice_item.media`（`voice_item.text` 为服务端转文字） |
| 4 | 文件 | `file_item.media` / `file_name` |
| 5 | 视频 | `video_item.media` |

## 媒体加解密

- 算法：**AES-128-ECB**（PKCS7 填充）。
- `aes_key` 编码兼容两种：base64 解码后为 16 原始字节（图片），或 32 位 hex 字符串（文件/语音/视频，需再按 hex 解析）。
- 下载：`full_url` 优先，否则用 `get_updates_buf` 拼接 `{cdn}/download?encrypted_query_param=<param>`。
- 上传：`getuploadurl` 获取上传 URL → AES 加密后 POST → 响应头 `x-encrypted-param` 即下载参数。
