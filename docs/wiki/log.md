# Wiki 操作日志

> 只追加、不修改历史。可用 `grep "^## \[" docs/wiki/log.md | tail -5` 看最近记录。
> 前缀格式：`## [YYYY-MM-DD] <ingest|query|lint|init|chore> | <简述>`

## [2026-09-16] init | wiki-memory hook 自动创建知识库骨架

## [2026-09-16] ingest | 内置后台 daemon（替代 PM2）+ headless 重登
- 决策：[后台常驻采用内置 daemon 而非 PM2](decisions/builtin-daemon-over-pm2.md)——根因是 headless 重登挂死（非 PM2 本身）
- 查询：[后台重登挂死与 daemon 落地排查](queries/background-relogin-hang.md)——stdin 无输入致 rl.question 永不 settle；计划任务免管理员必须 -User
- 实体：[内置后台 daemon 管理器](entities/daemon-manager.md)——src/daemon/（supervisor + 控制端 + 开机自启）
