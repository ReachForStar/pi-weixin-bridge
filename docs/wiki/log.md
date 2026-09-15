# Wiki 操作日志

> 只追加、不修改历史。可用 `grep "^## \[" docs/wiki/log.md | tail -5` 看最近记录。
> 前缀格式：`## [YYYY-MM-DD] <ingest|query|lint|init|chore> | <简述>`

## [2026-09-16] init | wiki-memory hook 自动创建知识库骨架

## [2026-09-16] ingest | 内置后台 daemon（替代 PM2）+ headless 重登
- 决策：[后台常驻采用内置 daemon 而非 PM2](decisions/builtin-daemon-over-pm2.md)——根因是 headless 重登挂死（非 PM2 本身）
- 查询：[后台重登挂死与 daemon 落地排查](queries/background-relogin-hang.md)——stdin 无输入致 rl.question 永不 settle；计划任务免管理员必须 -User
- 实体：[内置后台 daemon 管理器](entities/daemon-manager.md)——src/daemon/（supervisor + 控制端 + 开机自启）

## [2026-09-16] ingest | v1.5：安装向导 + 权限加固 + Linux 适配
- 实体：[安装向导与配置解析](entities/install-config.md)——install 路径选择、config.json 三级解析、700/600 权限、re-exec 与 LineReader
- 实体更新：daemon-manager（boot 跨平台 systemd 用户服务）
- 查询：[WSL 跨平台测试方法与共享 node_modules 坑](queries/wsl-cross-platform-testing.md)——平台原生 node_modules 不能共享；pty 交互模拟
- 验证：Windows 72/73（POSIX 权限跳过）+ WSL 73/73；真实微信扫码 e2e 通过（你好→回复 3s）
