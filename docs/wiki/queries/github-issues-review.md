---
title: GitHub 已知问题检查
type: query
tags: [GitHub, Windows, 可靠性]
created: 2026-10-01
updated: 2026-10-01
status: active
---

## 问题

用户要求使用 gh 查看项目 Issues。2026-10-01 查询全部状态后，仓库只有 [Issue #1](https://github.com/ReachForStar/pi-weixin-bridge/issues/1)，状态为 OPEN；标题为「[Bug] 中文 Windows 下 5 个缺陷：install-boot 全链路不可用、无 D 盘时崩溃循环、pi 出错时微信端静默无回复」。报告环境为 npm 1.6.1、Windows PowerShell 5.1、中文代码页与仅 C 盘。

## 根因与当前对应机制

- PowerShell 无 BOM、裸命令路径检查和错误字符串索引：开发分支不再调用相关 PowerShell 脚本，登录任务直接运行绝对 Node 路径。
- 默认 D 盘：src/config.ts 新安装使用用户主目录，已存在的旧配置按实际旧目录兼容；显式路径仍需用户提供可写目录。
- 模型处理失败无通知：src/bridge.ts 的 executeMessage 捕获错误并调用 notifier.finish 发送失败通知，随后继续向外报告错误供日志和任务记录处理；发送仍可能因微信或网络错误失败。

## 解法与验证边界

修复已合并 main 并发布 1.7.1，登录任务定义、默认目录及通知生命周期测试执行通过。实际注册成功，登录验收流程后的后台与普通微信回复正常；[模型连接失败通知](../sources/model-failure-validation-output.md)已由真实日志及用户微信确认验证，故障后的 /ping 和配置恢复后普通回复正常。用户确认文案后已发送[回复](https://github.com/ReachForStar/pi-weixin-bridge/issues/1#issuecomment-5924328507)，保持 Issue 打开供报告者升级核验；发布结果见[1.7.1 记录](release-1-7-1.md)。

## 五项缺陷与附加建议的范围

1.7.1 已处理五项主要缺陷的对应原因：PowerShell 编码、裸命令路径校验和参数插值所依赖的旧入口已移除；新安装默认工作目录使用用户主目录；模型异常通过任务通知回发。Windows 真实注册、登录验收输出与真实微信模型连接失败通知已有证据。

报告者在第 4 项另建议保存 last-error.txt 并在 status 中直接展示最近致命错误。当前 src/index.ts 只写服务日志与运行状态，src/cli.ts 的 printDaemonStatus 展示状态及日志路径，未实现该错误摘要机制。已有显式无效 workspace 不会被自动覆盖，仍需通过 config 修改。故五项主要缺陷已处理，不等于报告中的全部附加建议均已实现。人工故障验收覆盖连接失败，未逐一实测限流、鉴权或所有供应方错误类型。

## 涉及模块与复发预防

提交 609f17b 的 [CI 36807346131](https://github.com/ReachForStar/pi-weixin-bridge/actions/runs/36807346131) 已在 Windows、macOS 和 Linux 全部通过，包括依赖安装、类型检查、测试和构建；发布任务跳过。本地完整验证为 160 项通过、2 项按平台跳过，npm 打包与知识库校验通过。额外发现的英文 Windows 中文快捷方式保存和长参数截断缺陷也已修复并通过本轮验证。

关联[平台适配](../entities/platform-support.md)、[对话恢复与通知](../entities/conversation-recovery.md)、[终端无关机制](windows-shell-independence.md)。运行结果以实际三平台 CI 为准，旧版本故障报告保留，不套用报告中的桩件验证作为项目测试结果。
