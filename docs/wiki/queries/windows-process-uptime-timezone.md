---
title: Windows 进程运行时间时区错误
type: query
tags: [Windows, WMI, 时区, 统计]
created: 2026-10-01
updated: 2026-10-01
sources: [raw/references/windows-login-validation-output.md]
status: active
---

## 问题

用户登录后的 status 显示两个在线进程运行时间均为 0s，但日志已经处理微信消息。来源为[用户输出](../sources/windows-login-validation-output.md)。

## 根因

SWbemDateTime.GetVarDate 的 VT_DATE 不携带时区，默认返回本地时间；winax 转成 JavaScript Date 后被解释为 UTC。在本机真实进程诊断中，GetVarDate(true) 计算出 -28798.96 秒，而 process.uptime() 为 0.1013925 秒；GetVarDate(false) 为 1.044 秒，与本机进程年龄接近。默认调用产生约 8 小时偏移，Math.max(0, elapsed) 将负值隐藏成 0。

接口语义依据 [Microsoft GetVarDate 文档](https://learn.microsoft.com/en-us/windows/win32/wmisdk/swbemdatetime-getvardate)，不自行解析 CIM 日期字符串。

## 解法

scripts/windows-helper.js 明确调用 GetVarDate(false) 返回 UTC，再与 Date.now 比较；转换结果无效时立即失败。真实进程测试将系统统计与 process.uptime() 比较，容许 3 秒的系统时间精度差异，防止只检查非负数掩盖错误。

修复后直接读取用户正在运行的相同 PID，supervisor 显示 5m 54s、桥接显示 5m 53s，二者仍在线，重启计数 0。没有停止、重启桥接或修改系统任务。完整本地验证为 160 项通过、2 项按平台跳过，类型检查、构建、npm 打包及 wiki 校验通过。

## 涉及模块

scripts/windows-helper.js、src/daemon/procs.ts、test/platform.test.ts；关联[平台适配](../entities/platform-support.md)、[Windows 原生 COM](../entities/windows-native-com.md)。

## 复发预防

VT_DATE 转换必须明确时区，测试使用真实进程年龄作为独立参照。零运行时间不能作为进程刚启动的证据；初始化日志重复也不能直接作为崩溃证据。当前 supervisor 日志未记录 10 月 1 日异常退出，两次初始化具体原因仍待用户操作记录确认。
