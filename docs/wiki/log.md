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

## [2026-09-30] feat | 实现功能服务与后台机制基础

用户选择全部十项功能并确认两项固定依赖，新增状态、资料、任务、调度、权限、操作确认及模型向导模块；修复后台同步等待、停止请求和进程锁。阶段结论记录于 [微信功能服务与权限](entities/feature-services.md) 和 [后台守护进程](entities/background-daemon.md)，集成与验证仍在进行。

## [2026-09-30] feat | 统一 npm 安装并完善模型选择

用户要求安装与更新仅从 npm 获取，GitHub 保存源码；同步 CLI 和双语说明，记录 [npm 分发决策](decisions/npm-distribution.md) 和 [模型配置](entities/model-configuration.md)。首轮完整测试发现 SDK 供应方空配置无效、会话 UUID v7 的八位前缀不唯一，已按真实 SDK 接口修正；类型检查与构建通过，第二轮验证待执行。

## [2026-09-30] lint | 完成十项功能与 npm 分发验证

141 项测试通过、1 项 Windows 不适用权限测试跳过，类型检查、构建、PowerShell AST、真实 CLI 帮助和 npm 打包预检查通过。隔离目录实际验证后台启动、重复实例拒绝、等待扫码状态、停止和再次启动；构建产物调用真实 anydoc 转 PDF 通过。更新功能、模型、后台、文档转换及 npm 分发页面，旧候选标记被当前功能页面取代。npm audit 仍报告 3 项 moderate、3 项 high；未自动升级依赖，未运行真实微信、远程模型或云端 OCR 端到端操作。版本保持 1.6.1，未发布或推送。

## [2026-09-30] docs | 完善 npm 安装与功能使用说明

README 与英文说明统一 npm 全局安装、npm 更新和卸载，补充模型选择、文件与会话、资料库、权限、任务、定时、OCR 和预算使用边界，CHANGELOG 汇总未发布变更。知识库 Markdown、元数据和相对链接检查通过；代码保存为本地提交 e733411，文档随独立提交保存，不推送或发布。

## [2026-09-30] release | 准备发布 1.7.0

用户已授权发布，核对 npm/GitHub 最新为 1.6.1，远程 main 没有额外提交；同步版本与变更说明，实际发布结果待核验。见 [发布记录](queries/release-1-7-0.md)。

## [2026-09-30] release | 完成 1.7.0 发布前检查

类型检查、构建、141 项测试通过，1 项平台跳过；打包、CLI、CI 与 wiki 校验通过。准备推送 main 触发发布。

## [2026-09-30] release | 发布 1.7.0

CI 检查与发布成功，npm 官方 registry 的版本和 latest 均为 1.7.0，GitHub 正式 Release 标签指向通过检查的 968816a 提交。发布记录见 [1.7.0 发布记录](queries/release-1-7-0.md)。

## [2026-09-30] query | 解决 npm 全局更新目录占用

停止真实旧版后台后，npm 全局安装成功并核验为 1.7.0；恢复服务需要用户选择旧配置缺失的默认模型，已停止重复启动。见 [排查记录](queries/npm-global-install-ebusy.md)。

## [2026-09-30] feat | 增加独立 config 配置命令

实现交互配置和 show/get/set/unset/models/model，复用 SDK 目录与配置读写；准备版本 1.7.1，验证待执行，发布前仍需确认。见 [CLI 配置入口](entities/config-command.md)。

## [2026-10-01] lint | 完成 config 与 1.7.1 验证

150 项测试通过、1 项平台跳过，类型检查、构建、真实 CLI/交互输入、后台路径变更限制和 npm 打包通过。仅推送开发分支，未发布 1.7.1，等待用户发布确认。见 [CLI 配置入口](entities/config-command.md)。

## [2026-10-01] fix | 修复快捷方式创建参数与失败处理

Windows PowerShell 直接接收参数数组，避免 Author Software 路径截断；检查脚本退出码与 COM 错误。新增真实快捷方式回归验证，结果待核验；遵守用户暂不发布 1.7.1 的决定。见 [排查记录](queries/windows-shortcut-spaces.md)。

Windows PowerShell 直接接收参数数组，避免 Author Software 路径截断；检查脚本退出码与 COM 错误。新增真实快捷方式回归验证，结果待核验；遵守用户暂不发布 1.7.1 的决定。见 [排查记录](queries/windows-shortcut-spaces.md)。

## [2026-10-01] lint | 验证快捷方式路径空格修复

真实 Windows PowerShell 与 COM 快捷方式验证通过，153 项测试通过、1 项平台跳过，类型检查、构建、打包与 wiki 校验通过。修复保留于未发布 1.7.1。

## [2026-10-01] feat | 完善三平台安装与运行适配

增加 macOS LaunchAgent，复用系统 PowerShell、修复进程统计和 Linux 服务错误处理；新安装使用主目录，CI 扩展三平台。实现完成，验证待执行；版本 1.7.1 不发布。

## [2026-10-01] lint | 验证三平台适配的本地检查

Windows 156 项测试通过、2 项平台跳过，类型检查、构建、真实后台与进程统计通过；准备在开发分支执行三平台 CI，不发布。

## [2026-10-01] lint | 三平台 CI 全部通过

Ubuntu、Windows、macOS 的类型检查、完整测试与构建全部成功，macOS 真实 plutil 往返验证通过。运行 36743737351，提交 c26523d，publish 跳过，1.7.1 不发布。见 [平台适配](entities/platform-support.md)。

## [2026-10-01] fix | 改为终端无关的 Node 与系统接口

移除运行时 PowerShell/cmd 调用，Windows 使用 WSH/WMI/任务计划程序 COM；更新 npm 入口、CI 执行器与文档。实现待批量验证，1.7.1 不发布。

## [2026-10-01] query | 核验 winax 原生编译兼容性

用户允许安装 `winax@3.6.9`；现有 VS2022 C++ 工具与 Python 已被 node-gyp 找到，但 V8 HolderV2 模板编译失败。可选依赖被 npm 移除，不能据 npm 成功退出判定安装完成。已增加 Windows postinstall 模块检查，3.6.8 源码不含此项 Electron 41 兼容改动，固定版本变更等待确认。

## [2026-10-01] feat | 安装固定版本原生 COM 绑定

用户确认改用 `winax@3.6.8`，在 Node 22.23.2、VS2022 C++ 工具及 Python 上编译成功。Windows 适配脚本由 Node 执行，不调用 WSH、PowerShell 或 cmd；登录任务定义、快捷方式与进程统计等待统一验证。

## [2026-10-01] lint | 验证终端无关运行与原生接口

本地 28 个测试文件、160 项测试通过，2 项按平台跳过；类型检查、构建、真实 CLI 帮助、npm 打包及 wiki 校验通过。已验证真实 WMI、中文和空格目录的快捷方式读回、COM 登录任务定义、配置参数和退出码，未注册或卸载系统任务。1.7.1 不发布，提交后核验三平台 CI。

## [2026-10-01] query | 收集 CI 原生编译失败

7bcbff8 的 CI 36805465877 在 Windows 安装阶段因 winax 缺失而失败，postinstall 校验正确阻止继续运行。可选依赖的编译原因尚未输出；开启安装前台日志并关闭矩阵快速失败，收集三平台完整结果。未发布。

## [2026-10-01] fix | 固定 Windows 原生构建工具环境

CI 36805698061 的 macOS 与 Linux 全部通过；Windows 原因确定为 Visual Studio 18 未被 npm 内置 node-gyp 11.5.0 识别。固定 Windows 检查镜像为 windows-2022，官方镜像含 Visual Studio 2022；文档明确相同构建要求。新一轮 CI 待核验，1.7.1 未发布。

## [2026-10-01] query | 检查 GitHub 已知问题

通过 gh 查询所有状态 Issues，仅发现打开的 Issue #1，报告 1.6.1 的五项 Windows 与通知缺陷。逐项对应当前开发代码，记录未发布与真实登录自启尚未验证的边界，不评论或关闭 Issue。

## [2026-10-01] fix | 使用 Unicode 快捷方式接口

CI 36805970712 的 Windows 原生编译、类型检查及 159 项测试通过，失败集中在旧 WSH Save 将中文路径转换为问号。改用 ShellLinkObject.Save 的路径参数，从真实 COM 生成的模板创建快捷方式，并覆盖中文、空格和 emoji；本地与英文 Windows CI 待核验。

## [2026-10-01] lint | 验证 Unicode 快捷方式与启动参数

快捷方式使用相对 Node 启动文件名，将完整参数保存在生成的 CJS 文件中，避免 ShellLinkObject 长参数截断。中文、空格和 emoji 路径下实际执行生成的启动文件并验证参数和失败退出码；本地 160 项通过、2 项平台跳过，类型检查、构建、npm 模板分发与 wiki 校验通过。英文 Windows CI 待核验，真实登录自启未执行，1.7.1 未发布。

## [2026-10-01] lint | 核验三平台原生接口修复

提交 609f17b 的 CI 36807346131 在 Windows、macOS 与 Linux 全部通过，包含原生依赖安装、类型检查、测试及构建，发布任务跳过。已修复英文 Windows 中文快捷方式与参数截断，Issue #1 保持打开；真实登录自启及真实微信模型异常投递尚未操作。版本保持 1.7.1，代码已推开发分支。

## [2026-10-01] query | 沉淀登录自启与失败通知验收方式

按当前代码和已安装 SDK 核对实际系统登录验收与模型本地端点故障注入步骤，记录通过判据和配置恢复。说明注册会覆盖同名任务、测试会暂停后台及临时影响供应方会话；本次仅提供说明，未执行真实注册、注销、供应方配置修改或微信请求，1.7.1 不发布。

## [2026-10-01] fix | 修正登录任务身份与 COM 密码参数

用户实际注册返回 0x8007052e，后台未启动；旧日志不能代表此次结果。任务改用 WMI 当前进程所有者 SID，并传递空 VARIANT 密码；增加 TASK_VALIDATE_ONLY 的真实系统校验，验证待完成。保存脱敏终端摘录与排查页，不注册或移除用户任务，1.7.1 不发布。

## [2026-10-01] lint | 验证实际登录任务注册

用户明确授权注册并保留任务后，修复版真实注册成功，COM 读回验证账户身份、交互登录类型、登录触发器、Node 路径、开发版入口与工作目录正确。完整 160 项测试通过、2 项平台跳过，类型检查、构建、打包与 wiki 校验通过。首轮定时文件 rename EPERM 未在第二轮复现，原因未确定。未启动任务或注销用户，真实登录及微信模型失败通知仍待验收，1.7.1 不发布。

## [2026-10-01] fix | 核验登录后回复并修正运行时间

用户新输出显示后台在线，真实微信普通消息成功回复；旧模型配置错误属于历史日志。实际 WMI 诊断定位 GetVarDate 本地时间被当作 UTC，约 8 小时偏移导致运行时间显示零。明确使用 UTC 后，相同用户进程读回显示约 5 分钟，未停止或重启用户服务。完整本轮检查待结束；模型失败通知仍未验证，两次初始化具体触发操作未确定。

## [2026-10-01] lint | 验证真实运行时间修复

本地 160 项测试通过、2 项按平台跳过，新增真实进程运行时间与 process.uptime 比较；类型检查、构建、npm 打包与 wiki 校验通过。用户后台进程及自启任务保持运行，模型失败通知仍待验收，1.7.1 不发布。

## [2026-10-01] ingest | 确认真实模型连接失败通知验收

用户日志记录 Connection error.、后续 /ping，以及恢复配置后的“测试成功”回复；用户明确确认微信收到了失败通知且 /ping 正常。真实模型连接失败通知验收通过，保存脱敏证据并更新验收说明、通知模块和 Issue 对应边界。未修改模型配置或后台，不自动关闭 Issue，1.7.1 未发布。

## [2026-10-01] release | 取得 1.7.1 合并发布授权

用户明确要求合并开发代码到 main 并发布新版本，Issue #1 回复发送前须确认文案。核对 npm/GitHub 当前 1.7.0、开发版 1.7.1 及最新三平台 CI 成功；补全 CHANGELOG，准备通过 PR 合并触发版本变化发布。实际发布待核验，未发送 Issue 回复。

## [2026-10-01] release | 合并 1.7.1 到主分支

PR #2 已合并，main 提交为 4a0b9d4565dbbeb79679c67e13bba223baab60a0，版本由 1.7.0 更新为 1.7.1。CI 36811222768 正在检查并待发布结果；工作区以快进同步该提交，不修改用户后台或自启。Issue 回复尚未发送。

## [2026-10-01] git | 删除已合并开发分支

用户要求删除 codex/reliability-version-release；确认本地分支与 github/main 指向同一合并提交后，删除本地和远程分支，远程剩 main。主分支已在另一工作区检出，因此当前工作区保持该提交的 detached HEAD，保留未提交的发布记录，不改动另一工作区或用户后台。

## [2026-10-01] release | 确认 Release 与发布工作流成功

main CI 36811222768 三平台检查及 publish 全部成功，正式 GitHub Release v1.7.1 的标签指向 4a0b9d4565dbbeb79679c67e13bba223baab60a0。npm registry 初次查询仍为 1.7.0，等待上传后可查询；Issue #1 仍打开且未新增回复。

## [2026-10-01] release | 核验 npm 1.7.1 正式可用

官方 npm registry 后续在线查询确认 version 与 latest 都为 1.7.1，tarball 地址已返回；初次 404 属于上传后的处理窗口，不能作为永久发布失败。GitHub Release 与标签已核验，1.7.1 发布完成。开发分支已按用户要求删除，Issue 回复文案仍待确认。
