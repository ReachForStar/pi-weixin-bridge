# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
