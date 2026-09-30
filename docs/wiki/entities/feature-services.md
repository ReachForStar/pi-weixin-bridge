---
title: 微信功能服务与权限
type: entity
tags: [文件, 会话, 权限, 自动化, 模型]
created: 2026-09-30
updated: 2026-09-30
status: active
---

## 职责

实现用户确认的十项候选功能，以及扫码后的供应方和模型选择；本地集成、类型检查、测试、构建和打包检查通过。

## 关键文件与接口

- src/features/state.ts：自定义 JSON 状态的原子写入与按会话哈希隔离。
- src/features/library.ts：附件内容 SHA-256 去重、原件保存、基于 minisearch 的本地全文索引和来源片段。
- src/features/journal.ts：任务记录、message_id 去重、重启中断标记和人工重试依据，不保存 context_token 与下载解密参数。
- src/features/scheduler.ts：cron-parser 解析周期表达式和时区，单次日期要求带时区，仅投递文本，保存执行与投递状态；中断/失败暂停，不自动重复副作用。
- src/features/policy.ts：用户访问限制、项目选择、会话模型选择、发送路径的真实目录检查和只读诊断。
- src/features/approvals.ts：按会话绑定操作确认编号，拒绝、超时、退出后不执行。
- src/features/service.ts：文件、会话、资料、任务、自动化、OCR、权限和用量命令入口。
- src/models.ts、src/wizard.ts：读取 models.json 实际供应方，扫码后选择模型，不固定某个供应方；安装路径写入保留其他配置。
- scripts/convert-document.mjs：独立进程调用 anydoc 保存 Markdown 和支持的内嵌图片；PDF 不调用不受支持的 toDocument，云端 OCR 仅显式 hosted。
- src/pi/sessions.ts：按项目创建会话、自定义文件发送和资料检索工具；工具执行前验证只读/项目限制与确认；记录模型已报告用量。

## 上下游依赖

用户明确允许安装 cron-parser 5.10.1 和 minisearch 7.2.0，固定版本已安装，复用 anydoc 0.2.4 和 pi SDK 0.82.0。索引不上传文件；OCR 上传必须每文件确认。

安装后 npm audit 报告 6 项已存在依赖链告警（3 moderate、3 high），涉及 pi SDK、undici 和 Vitest 相关依赖，未自动升级不兼容版本；精确升级方案待核验。

## 重要变更记录

十项功能已集成到微信入口，CLI、双语说明和配置示例已同步。当前预算仅按模型已报告用量限制后续任务，缺失用量标记未知；工作目录与工具权限不是操作系统沙箱。

关联：[功能扩展调研](../queries/feature-roadmap-research.md)、[对话恢复与任务通知](conversation-recovery.md)、[入站文档自动转换](inbound-documents.md)、[后台守护进程](background-daemon.md)。

## 验证与使用边界

141 项测试通过、1 项跳过。新增测试使用真实 pi SDK、模型目录、输入流、许可证/README 文件、资料索引、定时器与自有子进程，验证历史恢复命名和 HTML 导出、资料去重及中文检索、任务记录与消息编号去重、重启中断、操作确认绑定/超时/退出、调度持久状态、白名单与只读工具拦截、路径越界和日预算状态。日预算测试验证本地账本与限额判定，未发送付费模型请求。

扫描 PDF 的 hosted 路径仅在单文件授权后执行，未使用真实微信或 Firecrawl 凭据做端到端上传；Office 图片提取使用 anydoc 返回资产，许可证 Word 转换路径已验证，图表解读仍依赖用户实际模型。

文件发送限定当前项目真实路径和默认 20 MiB，上限在上传前/下载保存后检查；下载时仍可能占用超过上限的内存。CDN 上传有 120 秒超时，上传地址请求和传输响应取消信号。资料检索最多最近 200 份、每份 2 MiB、返回 8 个片段；不自动清理原件或历史。

定时任务需要服务运行、原项目保持选择、有效微信上下文及管理员身份；单次执行只投递文本，guarded 项目定时采用只读工具，full 保留完整权限。失败或中断暂停，不补做已中断的执行；定时与手动任务共用同一对话队列。

关联：[供应方读取与会话模型配置](model-configuration.md)、[npm 分发](../decisions/npm-distribution.md)。
