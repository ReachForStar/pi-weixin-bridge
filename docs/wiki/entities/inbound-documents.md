---
title: 入站文档自动转换
type: entity
tags: [附件, anydoc, PDF, Markdown]
created: 2026-09-30
updated: 2026-09-30
status: active
---

## 职责

将微信收到的受支持文档先保存为原件，再通过 anydoc 转成 Markdown，提供给 pi 读取。

## 关键文件与接口

- src/ilink/media.ts：InboundMedia.files 返回文件名和实际保存路径，文件名不参与目录选择；随机前缀与 wx 写入避免并发覆盖。
- src/message/documents.ts：prepareInboundDocuments 使用 anydoc 的 formatFromBytes、formatFromPath 识别格式，优先内容签名；调用同一固定依赖中的 cli.js，不依赖系统全局命令。
- src/bridge.ts：媒体下载后执行转换，将 Markdown 路径及 read 指令加入提示；转换错误向微信发送专门提示，不继续伪装成功。
- src/message/task-notifier.ts：新增 converting 阶段。
- package.json/package-lock.json：固定 @firecrawl/anydoc 0.2.4，用户已明确授权安装。

## 上下游依赖

anydoc 负责成熟文件格式解析，桥接服务不自行编写 PDF、Office 或压缩包解析器。转换在独立 Node 进程中执行，参数数组传递，无 shell；隐藏窗口，每个文件 120 秒超时，输出最大 16 MiB。

## 重要变更记录

2026-09-30：类型检查、构建与全部测试通过（121 通过，1 项 POSIX 测试在 Windows 跳过）。真实 anydoc 转换项目许可证 PDF 和 Word 成功，验证了内容识别无扩展名 PDF、原件保留、损坏文件失败、取消处理，以及真实加密附件下载后的转换和路径限制。转换文件以原件路径加 .md 保存，独占写入且不覆盖原件。普通 Markdown 和不支持格式保持路径处理。

## 使用边界

下载支持任务取消，CDN 重试等待同样响应取消。媒体地址或密钥缺失、下载或保存失败时抛出 MediaDownloadError 并通知用户，本次任务不提交模型；不把错误包装成附件内容。视频使用随机文件名和独占写入避免并发覆盖。真实本地 HTTP 验证了断连后重试成功、403 不重试、三次失败终止、读取响应时取消且不重试；缺少附件地址同样明确失败。

明确传入 --ocr reject；扫描 PDF 返回退出码 3 时提示需要 OCR，不上传。启用 Firecrawl 云端 OCR 须另行确认，不由本模块自动执行。转换失败保留原件，并将详细原因保存在服务日志。

真实微信账号、远程模型读取、扫描 PDF 与云端 OCR 未进行端到端验证。测试文档内容来自仓库 LICENSE，不使用伪造格式内容。

构建产物调用 anydoc 转 PDF 和 npm 打包预检查均通过，新增模块包含在包的 src 文件目录中。

关联：[对话恢复与任务通知](conversation-recovery.md)、[anydoc 依赖](anydoc.md)。
