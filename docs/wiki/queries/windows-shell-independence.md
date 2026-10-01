---
title: 终端无关运行机制与 Windows CI
type: query
tags: [Windows, Node, CI, 自启]
created: 2026-10-01
updated: 2026-10-01
status: active
---

## 问题

用户反馈 Windows 登录自启注册出现 PowerShell 解析乱码，并要求程序脚本不关联 PowerShell 或 cmd。远程 Windows CI 失败项为进程统计测试超时，尚未进入构建。

## 根因

Windows PowerShell 5.1 将无 BOM 的 UTF-8 脚本按本地编码读取；本机独立语法检查确认 stop-service.ps1 与 install-boot.ps1 各出现 3 处解析错误。原统计使用两次 PowerShell 启动，CI 默认 5 秒测试时限不足。

## 解法

业务及 CLI 统一使用 Node。Windows 适配层使用当前 Node 与原生 COM 绑定，通过 WMI 读取进程、COM 创建快捷方式与登录任务；输出使用 UTF-8，路径与配置参数保留中文和空格。启动器直接运行 Node，等待完成并传播退出码。已有 PowerShell 脚本保留在源码历史范围，不再由 CLI 使用或随 npm 包分发。

npm 更新直接执行当前 Node 安装中的 npm-cli.js。npm 的 exports 不开放 bin/npm-cli.js，先解析 npm/package.json 再定位 bin 入口；同时支持 Windows Node 目录与 POSIX lib/node_modules 布局。CI 检查步骤也直接调用 Node，使用 JSON 参数和标准 JSON 解析，避免命令解释器转义。

## 涉及模块

src/platform.ts、src/npm-command.ts、scripts/windows-helper.js、scripts/ci-run.mjs、src/daemon/boot.ts、src/daemon/procs.ts、src/cli.ts；关联[平台适配](../entities/platform-support.md)与[后台守护进程](../entities/background-daemon.md)。

## 复发预防

首轮完整验证结果：类型检查、构建、npm 打包及 wiki 校验通过；测试 155 项通过、4 项失败、2 项平台跳过。失败集中于 Windows WSH 接口。独立 JScript、VBScript、32 位与 64 位宿主均返回 0xC0000005，无输出；原因未确定。用户确认安装的 `winax@3.6.9` 在 Node 22.23.2 上出现 V8 HolderV2 模板编译失败；npm 将可选依赖移除。用户随后确认改用 `winax@3.6.8`，现有 VS2022 C++ 工具和 Python 成功编译生成 node_activex.node，真实接口验证通过。

真实验证覆盖中文及空格路径、COM 读回快捷方式、COM 生成登录任务定义、隐藏启动真实 Node 子进程、配置传递与失败退出码、当前 npm JavaScript 入口。测试不注册或删除系统任务，不启动用户实际桥接。原生模块若编译失败则通过 postinstall 明确终止安装，无静默替代路径。快捷方式最小化启动，后台子进程隐藏窗口。新实现本地类型检查、构建、160 项测试、npm 打包与 wiki 校验通过，2 项按平台跳过；三平台 CI 待核验；版本保持 1.7.1，不发布。
