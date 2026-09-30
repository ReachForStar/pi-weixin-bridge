---
title: Windows 快捷方式脚本路径空格
type: query
tags: [Windows, 安装, PowerShell]
created: 2026-10-01
updated: 2026-10-01
status: active
---

## 问题

用户安装日志中，后台已启动，但创建快捷方式时 -File 参数被截为 Author，PowerShell 报扩展名无效，CLI 仍显示安装完成。

## 根因

src/cli.ts 使用 spawnSync 的 shell: true 运行 PowerShell，含空格的 npm 包路径经命令解释器重新解析。调用没有检查子进程退出码；create-shortcuts.ps1 也把错误降为警告，导致安装成功提示缺少依据。

## 解法

使用 SystemRoot 下 Windows PowerShell 的绝对可执行路径，直接传递参数数组，关闭额外 shell，隐藏窗口并限制超时；检查启动错误与退出码。脚本启用 Stop 错误策略，目标缺失或 COM 创建失败直接抛出；快捷方式目标使用绝对 PowerShell 路径，-File 参数保留引号。

## 涉及模块

src/cli.ts、create-shortcuts.ps1、test/shortcuts.test.ts；[后台守护进程](../entities/background-daemon.md)。

## 复发预防

新增真实带空格目录生成 .lnk、COM 读取工作目录与参数、缺少启动脚本和打包脚本的失败测试。真实 Windows PowerShell 验证通过：带空格目录实际生成两个 .lnk，COM 读取确认绝对目标路径、带引号的脚本参数和工作目录；缺少启动脚本或打包脚本时明确失败。完整检查为 153 项测试通过、1 项平台跳过，类型检查、构建、PowerShell AST、打包和 wiki 校验通过。1.7.1 保持不发布，用户于本次修复前明确选择暂不发布。
