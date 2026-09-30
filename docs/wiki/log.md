# Wiki 操作日志

> 只追加、不修改历史。可用 `grep "^## \[" docs/wiki/log.md | tail -5` 看最近记录。
> 前缀格式：`## [YYYY-MM-DD] <init|feat|fix|query|lint|chore> | <简述>`

## [2026-09-30] init | wiki-memory hook 自动创建知识库骨架

## [2026-09-30] query | 发布前可靠性检查

读取现有代码确认自动发布、退避等待、HTTP 正文超时和文本分块边界问题，记录于 [发布前可靠性检查](queries/pre-release-reliability.md)。实施方案及依赖安装待用户确认，尚未运行验证。

## [2026-09-30] fix | 修复桥接可靠性并增加发布确认

用户确认方案及依赖安装后，完成退出等待、HTTP 正文超时、文本分块与人工发布条件修改。新增 [桥接运行可靠性](entities/bridge-reliability.md) 与 [发布前人工确认](decisions/manual-release-confirmation.md)，验证待执行。

## [2026-09-30] lint | 通过代码验证

npm run typecheck、npm test、npm run build 全部成功；107 项测试通过，1 项 POSIX 权限测试在 Windows 跳过。更新 [桥接运行可靠性](entities/bridge-reliability.md) 与 [发布前可靠性检查](queries/pre-release-reliability.md)。微信真实账号端到端路径与远程发布未执行。

## [2026-09-30] feat | 按推送前后版本变化发布

按用户最新要求，改为版本号变化且检查成功才发布；新增 scripts/release-version.mjs，更新 [发布前人工确认](decisions/manual-release-confirmation.md)。修改新版本号与推送仍须先获得用户确认，版本比较验证待执行。

## [2026-09-30] lint | 通过发布配置与知识库校验

使用现有依赖中的 YAML 与 Markdown 库解析 CI 配置和 wiki，全部元数据与相对链接有效；用真实 Git 历史验证版本不变、版本变化、新建分支与 Actions 输出文件；CLI help 可正常启动。新增 [后续功能候选](queries/feature-candidates.md)，本次未实施候选功能。

## [2026-09-30] feat | 增加对话恢复和任务通知

用户选择两项功能后，复用 SDK 会话文件实现恢复与 /new 持久切换，增加任务进度、失败和停止通知。完成队列与图片回复上下文隔离，记录于 [对话恢复与任务通知](entities/conversation-recovery.md)，验证待执行。

## [2026-09-30] lint | 通过对话恢复与通知验证

npm run typecheck、npm test、npm run build 全部成功；115 项测试通过，1 项 POSIX 权限测试在 Windows 跳过。包含真实 SDK 跨进程恢复、新建对话、隔离、队列和通知生命周期；更新 [对话恢复与任务通知](entities/conversation-recovery.md) 与 [后续功能候选](queries/feature-candidates.md)。真实微信与远程模型端到端任务未执行。

## [2026-09-30] feat | 增加入站文档转换

用户指定 anydoc 并确认安装 0.2.4 固定依赖。新增结构化附件信息、文件名安全保存、文档转换及转换进度与失败提示；即时沉淀 [入站文档自动转换](entities/inbound-documents.md) 与 [anydoc 依赖](entities/anydoc.md)。扫描 PDF 不自动上传，运行验证待执行。

## [2026-09-30] lint | 通过真实 anydoc 文档转换验证

类型检查、构建和全部测试成功；121 项通过，1 项 POSIX 测试在 Windows 跳过。真实 PDF、Word、内容格式识别、原件保留、损坏文件、取消任务与加密附件下载后转换均通过；更新 [入站文档自动转换](entities/inbound-documents.md) 和 [anydoc 依赖](entities/anydoc.md)。真实微信账号与远程模型端到端未执行。

## [2026-09-30] lint | 通过构建产物和打包检查

构建后的 documents.js 调用真实 anydoc 转换 PDF 成功；npm pack --dry-run 成功且包含新增转换模块。Wiki 元数据、Markdown 和相对链接校验通过；版本仍为 1.6.1，未执行推送或发布。

## [2026-09-30] feat | 完善任务排序与附件取消

补齐同一对话从附件到回复的完整队列，/stop 取消当前与等待任务并保留后续消息可用，下载重试响应取消；媒体协议和下载失败明确通知且不提交模型。同步 [对话恢复与任务通知](entities/conversation-recovery.md) 和 [入站文档自动转换](entities/inbound-documents.md)，运行验证待执行。

## [2026-09-30] lint | 通过完整任务生命周期验证

类型检查、构建和全部测试通过，126 项通过、1 项 POSIX 权限测试在 Windows 跳过。任务队列使用真实文档转换及文件读取验证顺序、隔离、停止后恢复；附件重试测试改用真实本地 HTTP 和仓库 LICENSE，验证下载取消及失败边界。真实微信账号与远程模型端到端未执行。

## [2026-09-30] feat | 增加微信任务管理命令

为任务增加唯一编号、状态与时间，新增 /tasks 和 /cancel，支持查看当前对话任务并单独取消，其余任务继续。同步帮助、README 和 [对话恢复与任务通知](entities/conversation-recovery.md)，运行验证待执行。

## [2026-09-30] lint | 通过任务管理命令验证

类型检查、构建通过，128 项测试通过、1 项 Windows 不适用权限测试跳过。新增测试使用真实文件读取和取消信号，通过实际 SlashCommandHandler 验证列表、编号校验、按对话隔离、精确取消与完成清理；更新 [对话恢复与任务通知](entities/conversation-recovery.md)。

## [2026-09-30] query | 调研微信桥接可增加功能

核对项目代码、已安装 pi SDK 和 anydoc 文档，并阅读 OpenClaw 与社区微信插件维护者资料，沉淀 [微信桥接功能扩展调研](queries/feature-roadmap-research.md)。推荐文件回传、历史会话和附件资料库，明确访问权限、任务副作用和主动投递令牌约束。仅调研，未实现候选、未安装依赖、未修改版本或发布。
