---
title: Windows 全局更新 EBUSY
type: query
tags: [npm, Windows, 后台]
created: 2026-09-30
updated: 2026-09-30
status: draft
---

## 问题

用户直接运行 npm install -g pi-weixin-bridge@latest，npm 重命名原安装目录失败，返回 EBUSY。

## 根因

npm 日志确认失败发生于替换旧包目录。真实进程列表显示该目录下 1.6.1 的 daemon supervise 和 start 仍运行，停止前未完成更新。停止这两个进程后，原 npm 安装命令成功，确认本次占用来自旧版后台。

## 解法

已执行 pi-weixin-bridge daemon stop，并确认目标 Node 进程退出。npm 全局安装成功，npm list -g 核验为 1.7.0。首次恢复后台因旧 config.json 没有默认模型而退出，已停止 supervisor 重试；SDK 读取 models.json 得到两个可选模型，等待用户选择后保存配置并恢复后台。

## 涉及模块

[后台守护进程](../entities/background-daemon.md)、[npm 分发](../decisions/npm-distribution.md)。

## 复发预防

正在运行的 Windows 服务更新前先停止后台，安装成功后再启动；安装失败保持停止。1.6.1 升级至 1.7.0 后，旧配置未保存 model 时须选择默认模型，不能从 models.json 中任意指定。未核对进程前不能删除包目录或终止所有 Node 进程。
