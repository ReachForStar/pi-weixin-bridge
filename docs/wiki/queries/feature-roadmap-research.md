---
title: 微信桥接功能扩展调研
type: query
tags: [功能规划, 微信, 会话, 附件, 自动化]
created: 2026-09-30
updated: 2026-09-30
status: active
---

## 问题

用户要求调研还可以增加哪些功能。本页只记录调研与候选设计，不构成实施或发布授权。调研日期为 2026-09-30；优先顺序是基于当前实现及用户已选择文档处理、会话恢复和任务管理所作的判断，不是用户研究数据。

## 根因与现状依据

- 已实现：对话恢复、/new、任务进度与失败通知、完整任务队列、/tasks、/cancel、/stop、anydoc 文档转换、图片回传、skills/MCP 入口及全局模型切换。见 [对话恢复与任务通知](../entities/conversation-recovery.md)、[入站文档自动转换](../entities/inbound-documents.md)。
- src/ilink/media.ts 已有 uploadFile，src/message/builder.ts 已有 buildFileMessage，但 src/pi/sessions.ts 只注册 send_weixin_image，ReplyContext 只开放 sendImage。文件回传的微信侧基础存在，Agent 侧尚未接通。
- src/pi/conversation-store.ts 保留 /new 之前的 JSONL；没有历史会话列表、命名、切换和导出命令。
- 已安装 pi SDK 0.82.0 的 session-manager.d.ts 有 SessionManager.list、open、getSessionName；agent-session.d.ts 有 setSessionName、compact、navigateTree、exportToHtml。SDK 可复用，不需手写会话格式解析。
- src/message/task-queue.ts 任务信息只在内存中保存，结束即移除；src/bridge.ts 未按 message_id 保存去重记录。会话恢复不等于任务恢复。
- src/config.ts 的工作目录和 src/pi/sessions.ts 的模型配置为全局使用；尚无按用户/项目设置工作目录或模型的界面。
- src/bridge.ts 尚无发送者白名单；工作目录参数本身不提供文件系统或进程隔离。
- [anydoc 依赖](../entities/anydoc.md)的已安装 README 说明本地不提供 OCR，扫描文档可显式上传 Firecrawl；toDocument 返回的 document.assets 保留内嵌图片，而 Markdown 只保留替代文本或外部链接。

## 解法：候选功能

下列命令均为候选设计，当前尚未实现。

### 优先候选

1. **文件回传与结果导出**：将转换后的 Markdown、生成的 PDF/Word/Excel 作为微信文件发送，避免只收到电脑路径。复用 uploadFile、buildFileMessage，增加 Agent 文件发送工具。发送前检查实际路径、允许发送的目录、文件类型与大小；文件生成能力取决于已有 skills 和工具，不由回传接口保证。验证需真实微信附件收发。
2. **历史会话管理**：候选 /sessions、/resume、/rename、/export，找回 /new 前的对话，并保留多个主题。复用 SDK 列表、打开、命名、导出功能；切换仍须通过完整任务队列，原子更新 current.json。只列出当前账号及对话自己的目录，不使用全局 listAll 暴露他人历史。
3. **附件资料库与来源引用**：将原件、Markdown、文件标识、时间和摘要关联保存；支持检索旧文件、比较多份文档、回答时引用原文件与标题。复用 anydoc 转换结果，可接入本地 qmd；需要按用户隔离索引、去重、限定保留策略和删除授权。当前“转换后让 pi 读取”尚不等于资料库管理。
4. **访问授权与只读模式**：限定微信发送者；区分管理员与普通使用者，允许指定用户使用 read/搜索工具，限制命令执行、改写和文件回传。可借鉴 [OpenClaw 配对机制](https://docs.openclaw.ai/channels/pairing)。只读权限应在工具调用位置执行，不能只靠提示词；实际隔离需要受限进程或容器。若服务开放给其他使用者，授权应排在新增自动化之前。

### 需要额外状态或执行机制的候选

5. **持久任务记录、去重和人工恢复**：保留任务完成/失败/停止状态、错误类别与结果文件；重启后显示中断任务并允许用户选择继续。入口按账号和 message_id 去重；任务意图与结果需持久保存。不得自动重复执行已经产生副作用的命令或工具。参考 [OpenClaw 持久入站机制](https://docs.openclaw.ai/plugins/sdk-channel-plugins/durable-ingress)，该参考接口标为实验性；本项目无需引入 OpenClaw。
6. **定时提醒与周期任务**：单次提醒、每天生成摘要、定期检查文件或服务并通知变化。参考 [OpenClaw 自动化](https://docs.openclaw.ai/automation/cron-jobs)，持久化时间、Asia/Shanghai 等时区、任务指令与执行记录；应使用调度库处理成熟时间格式，不能通过长时间 sleep 实现。每次运行选用独立会话，限制并发并允许暂停/删除。微信投递约束见下文。
7. **扫描 PDF 的授权 OCR 与图文文档理解**：遇到 needsOcr 时保存待处理附件，用户明确确认该文件上传 Firecrawl 后再转换；绑定文件与确认请求、设置超时，不能将一次确认推广到后续全部附件。另一项相关能力是保留 document.assets 内嵌图片，供支持视觉的模型理解图表；这是图文处理，不等同于 anydoc 本地 OCR。新增运行路径、计费和附件外传均需另外验证。
8. **项目配置与会话独立模型**：一个微信入口切换多个项目，各自指定允许工作目录、模型、工具和 skills；简单问答与复杂开发可使用不同已配置模型。当前 /model 是全局切换，新增会话级设置应避免影响其他对话。项目切换需要隔离状态、目录权限与图片/文件回复上下文，不能只替换一个全局路径。
9. **工具执行确认**：修改文件、运行命令、向外部发送内容前，显示具体操作，用户回复带请求编号的确认。参考 [OpenClaw 执行审批](https://docs.openclaw.ai/tools/exec-approvals)。需要在执行端绑定账号、对话、操作内容与有效期，并支持拒绝、取消和失效；不能仅发送确认文本后继续执行。现有 pi 扩展的交互与阻断方式还需专项核验，不能假设 bindExtensions({}) 已实现微信审批。
10. **用量预算与诊断**：基于已有 /usage 增加按日、按会话的统计和额度；添加配置连通性、附件转换与状态目录检查。模型未返回 usage 时必须显示未知，不能承诺精确成本上限。诊断结果不得包含令牌或完整用户消息；修复动作与只读诊断分开授权。

## 微信协议约束与调研来源

[社区 openclaw-weixin 维护者指南](https://openclaw-weixin.newfuture.cc/en/guide.html)指出：主动发消息需要由对应账号收到用户消息后获得的 context_token，令牌缺失应拒绝投递，长期空闲后令牌可能失效，需要用户发消息刷新。因此定时任务要记录投递失败，不能保证任意时间、任意用户都可主动发送；本次未确定令牌固定有效期，也未用真实微信验证定时投递。

同一指南介绍按完成的文本段落发送中间输出，并说明不是逐 token 流式发送。如果增加更即时的回答，可做可配置的段落发送和限频，避免每个 token 都变成一条微信消息；本项目当前只发送最终文本和周期任务通知。

[OpenClaw 会话工具](https://docs.openclaw.ai/concepts/session-tool)提供会话列表、检索与历史访问，并区分访问范围，可作为历史会话与资料检索的产品参考。功能实现仍以本地已安装的 pi SDK 为依据。

本地参考：src/pi/sessions.ts、src/pi/conversation-store.ts、src/message/task-queue.ts、src/ilink/media.ts、src/message/builder.ts、src/ilink/context-store.ts，以及已安装 pi SDK 声明文件与 anydoc README。只读取公开网页，未向外部上传仓库代码、会话或附件；没有安装依赖。

## 涉及模块

微信桥接入口、命令处理、媒体上传、pi 自定义工具、会话持久化、任务队列、配置和文档转换。发布仍遵循 [发布前人工确认](../decisions/manual-release-confirmation.md)。

## 复发预防与选择建议

个人文件助手场景优先文件回传、历史会话管理、附件资料库；多人使用场景优先访问授权和工具权限；定时任务与任务恢复应先设计持久状态、投递失败和副作用处理。上述优先级是建议，尚未选定实施范围。
