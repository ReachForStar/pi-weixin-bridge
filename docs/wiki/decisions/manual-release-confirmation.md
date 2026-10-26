---
title: 发布前人工确认
type: decision
tags: [发布, CI]
created: 2026-09-30
updated: 2026-09-30
status: active
---

## 背景

用户明确要求发布新版本前确认。原工作流在 main 推送后自动发布，用户于 2026-09-30 明确授权发布新版本，本次拟发布 1.7.0。

## 备选方案

- 保留自动发布：无需人工操作，但无法满足本次确认要求。
- 比较推送前后版本：仅版本变化才发布，符合用户最新要求；人工确认在修改版本与推送之前完成。

## 决策

采用推送前后版本比较；check 任务用 scripts/release-version.mjs 比较 github.event.before 的 package.json 与当前版本，输出 version 和 changed。publish 仅在 main push、changed 为 true 且质量检查成功时运行。新建分支不触发发布，PR 只检查。修改新版本号和推送前须获得用户确认，本次发布 1.7.0 已取得用户确认。

## 理由

对应用户明确修正后的要求“版本号变了再发布新的包和 release”；比较整个推送前后状态，避免多次提交中版本修改未处于最后一个提交时漏发。

## 后果

版本未变的推送和 PR 只检查。上传前检查变更说明；npm 已存在版本时跳过上传并允许补建 Release；新建 Release 指向当前工作流提交。确认要求属于维护操作约束，CI 不另设审批步骤。已通过 YAML 库解析与条件检查，并用真实 Git 历史验证同版本、不同版本、新建分支和 GITHUB_OUTPUT 写入；1.7.0 远程发布结果见关联发布记录。

关联：[1.7.0 发布记录](../queries/release-1-7-0.md)、[发布前可靠性检查](../queries/pre-release-reliability.md)。
