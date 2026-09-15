---
title: WSL 跨平台测试方法与共享 node_modules 坑
type: query
tags: [wsl, linux, 测试, node_modules, 跨平台]
created: 2026-09-16
updated: 2026-09-16
sources: []
status: active
---

# WSL 跨平台测试方法与共享 node_modules 坑

## 问题

需要在 Windows 主机上用 WSL 验证 Linux 行为（daemon 进程组 kill、systemd 用户服务、POSIX 权限）。直接 `/mnt/d/...` 下跑会踩坑。

## 根因 / 坑

1. **共享 node_modules 被平台污染（最大坑）**：在 WSL 里对 `/mnt/d/file/<repo>` 跑 `npm ci`，会按 Linux 平台重装——esbuild 等 optional 依赖变成 linux 二进制、`.bin` 里 Windows 需要的 `.cmd` shim 被替换。之后 Windows 端 `npm run typecheck` 直接报 `tsc 不是内部或外部命令`。**Windows 与 WSL 不能共享同一份 node_modules**。
2. 交互向导在 pty 里用管道喂答案时，两行快速到达会在第二个 `question()` 之前被 readline 丢弃（EOF 还会触发 `AbortError: Aborted with Ctrl+D`）——已用带缓冲的 LineReader 修复（见 [安装向导与配置解析](../entities/install-config.md)）。

## 解法 / 做法

- **WSL 用 Linux 原生副本**：`tar cf - --exclude node_modules --exclude dist . | (cd ~/piwx && tar xf -)`，在 `~/piwx` 里独立 `npm ci`。改代码后 `tar cf - -C /mnt/d/<repo> src test | tar xf - -C ~/piwx` 同步（不碰 node_modules）。
- **WSL 装 Node 免 root**：官方 tarball 解压到用户目录（`node-v22.x-linux-x64.tar.xz` → `~/`），`export PATH=~/node-.../bin:$PATH`。
- **pty 模拟交互终端**：`printf '答案1\n答案2\n' | script -qec 'node bin/...' /dev/null`（`script` 分配 pty，isTTY=true 触发交互分支）。
- 验证进程是否残留时，`pgrep -f` 会误匹配外层 bash 的命令行（命令行里含项目名）——用 `kill -0 <pid>` 精确验证具体 PID。

## 涉及模块

- `src/daemon/`（POSIX 进程组 kill、systemd unit）、`src/wizard.ts`（pty 交互）、`test/`（skipIf win32 的 POSIX 权限用例）

## 复发预防

- 跨平台验证一律用平台原生 node_modules；`/mnt/c|d` 只放源码与构建产物。
- 提交前 Windows 端若报 `.bin` 命令丢失，先怀疑 WSL 侧动过共享 node_modules，`npm ci` 恢复。
