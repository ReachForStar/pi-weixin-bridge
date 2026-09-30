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
