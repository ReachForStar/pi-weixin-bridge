---
type: index
updated: 2026-09-16
---

# Wiki 索引

> 人工/Agent 显式查阅用的完整目录；会话中的导航由 wiki-memory hook 注入的目录树提供。
> 格式：`[页面标题](相对路径) — 一行摘要`。

## 实体 entities

- [内置后台 daemon 管理器](entities/daemon-manager.md) — src/daemon/：supervisor 崩溃重启 + 控制端 + 开机自启计划任务，零第三方依赖替代 PM2

## 概念 concepts

## 源总结 sources

## 决策 decisions

- [后台常驻采用内置 daemon 而非 PM2](decisions/builtin-daemon-over-pm2.md) — ADR：根因是 headless 重登挂死（非 PM2 本身），故选内置 daemon + headless 重登，PM2 降级为可选

## 查询沉淀 queries

- [后台重登挂死与 daemon 落地排查](queries/background-relogin-hang.md) — 后台 stdin 无输入致 rl.question 永不 settle 的根因与解法；Windows 计划任务免管理员必须 -User 等踩坑备忘
