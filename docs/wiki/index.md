---
type: index
updated: 2026-09-16
---

# Wiki 索引

> 人工/Agent 显式查阅用的完整目录；会话中的导航由 wiki-memory hook 注入的目录树提供。
> 格式：`[页面标题](相对路径) — 一行摘要`。

## 实体 entities

- [内置后台 daemon 管理器](entities/daemon-manager.md) — src/daemon/：supervisor 崩溃重启 + 控制端 + 开机自启（Windows 计划任务 / Linux systemd 用户服务），零第三方依赖替代 PM2
- [安装向导与配置解析](entities/install-config.md) — src/wizard.ts + config.ts + account.ts：install 路径选择、config.json 三级解析、凭据权限加固（700/600）、re-exec 与 LineReader 设计

## 概念 concepts

## 源总结 sources

## 决策 decisions

- [后台常驻采用内置 daemon 而非 PM2](decisions/builtin-daemon-over-pm2.md) — ADR：根因是 headless 重登挂死（非 PM2 本身），故选内置 daemon + headless 重登，PM2 降级为可选

## 查询沉淀 queries

- [后台重登挂死与 daemon 落地排查](queries/background-relogin-hang.md) — 后台 stdin 无输入致 rl.question 永不 settle 的根因与解法；Windows 计划任务免管理员必须 -User 等踩坑备忘
- [WSL 跨平台测试方法与共享 node_modules 坑](queries/wsl-cross-platform-testing.md) — WSL/Linux 原生副本测试法、pty 交互模拟、跨平台 node_modules 不能共享
