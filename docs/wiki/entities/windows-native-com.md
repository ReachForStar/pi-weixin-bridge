---
title: Windows 原生 COM 绑定
type: entity
tags: [Windows, winax, 依赖]
created: 2026-10-01
updated: 2026-10-01
status: active
---

## 职责

固定版本 `winax@3.6.8` 为 Node 提供 Windows COM 接口，替代独立 PowerShell 与 Windows Script Host 进程。依赖为 MIT 许可，不向外部上传用户文件。

## 关键文件与接口

- scripts/windows-helper.js：通过 winax.Object 创建快捷方式、登录任务定义与 WMI 查询；普通运行操作直接调用 Node 子进程。
- scripts/check-native.mjs：Windows 安装时实际加载原生模块，阻止 npm 将可选依赖编译失败视为可用安装。
- src/platform.ts：以参数数组启动当前 Node，捕获接口错误及非零退出码。
- package.json 与 package-lock.json：固定版本、可选依赖与安装校验；非 Windows 平台不加载此模块。

## 上下游依赖

Windows 从源码编译需要 Visual Studio 2022 C++ 构建工具与 Python。3.6.8 在本机 Node 22.23.2 上成功编译，真实 WMI、中文与空格目录的快捷方式读回、登录任务定义及启动参数和退出码验证通过。Node 主版本变更后需重新安装并验证原生模块。参考[上游说明](https://github.com/durs/node-activex/blob/master/README.md)。

CI 36805698061 的 Windows 镜像包含 Visual Studio 18，npm 内置 node-gyp 11.5.0 无法识别，导致绑定未编译。macOS 与 Linux 安装和检查通过。Windows CI 固定为 windows-2022，其 [官方软件清单](https://github.com/actions/runner-images/blob/main/images/windows/Windows2022-Readme.md)提供 Visual Studio 2022；新一轮验证待完成。

## 重要变更记录

3.6.9 在本机出现 V8 HolderV2 模板编译失败，npm 移除了可选模块；用户确认改用 3.6.8。不修改上游源码，不切换项目 Node 版本，不在模块缺失时静默替代。快捷方式最小化启动 Node，后台子进程隐藏窗口；登录任务定义测试不注册或移除真实系统任务。

关联：[平台适配](platform-support.md)、[终端无关运行机制](../queries/windows-shell-independence.md)。
