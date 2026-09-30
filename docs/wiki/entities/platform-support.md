---
title: Windows macOS Linux 适配
type: entity
tags: [平台, 安装, 后台, CI]
created: 2026-10-01
updated: 2026-10-01
status: active
---

## 职责

统一三平台 npm 安装、配置、后台运行与登录自启，保持 1.7.1 未发布。

## 关键文件与接口

- src/platform.ts：定位系统 Windows PowerShell，不依赖额外 pwsh。
- src/daemon/boot.ts：Windows 计划任务、Linux systemd 用户服务、macOS LaunchAgent；不支持的系统明确拒绝。
- src/daemon/procs.ts：Windows 使用 JSON 统计，Linux getconf 获取实际 CLK_TCK，macOS 使用 ps 百分比而非百分比差值。
- src/config.ts：新安装使用用户主目录，旧 Windows 配置与存在的旧工作目录继续兼容。
- .github/workflows/ci.yml：main 与 codex/** 推送检查三平台，发布仍只允许 main 版本变化。

## 上下游依赖

复用 Node 和系统工具，不引入新依赖。macOS 配置由 JSON 经系统 plutil 转换为 plist，避免手写 XML。参考 [Apple LaunchAgent 文档](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)与 [Apple launchctl 手册](https://github.com/apple-oss-distributions/launchd/blob/main/man/launchctl.1)。

## 重要变更记录

macOS LaunchAgent 前台运行 daemon supervise，不使用会自行退出的 daemon start；不配置 KeepAlive，避免手动停止后被系统强制拉起。注册前要求停止已有 supervisor，卸载失败保留 plist 并报错。Linux disable 与 reload 失败不再宣称成功。

## 验证与边界

本地 Windows 类型检查、构建与 28 个测试文件通过（156 项通过、2 项平台跳过），真实 Node 进程统计、系统 PowerShell、后台生命周期和快捷方式通过；npm 打包与 wiki 校验通过。[远程三平台 CI](https://github.com/ReachForStar/pi-weixin-bridge/actions/runs/36743737351) 在 c26523d 提交全部成功：Ubuntu、Windows、macOS 均完成依赖安装、类型检查、完整测试和构建；发布任务按条件跳过。系统登录自启注册属于用户机器变更，本地验证不操作用户自启。macOS plutil 往返验证在真实 macOS CI 中执行；真实注册和登录后的运行仍需对应系统环境核验。

关联：[后台守护进程](background-daemon.md)、[配置入口](config-command.md)、[快捷方式路径](../queries/windows-shortcut-spaces.md)。
