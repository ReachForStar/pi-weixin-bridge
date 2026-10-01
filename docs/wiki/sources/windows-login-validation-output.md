---
title: 用户登录后后台与微信验收输出
type: source
tags: [Windows, 自启, 验收]
created: 2026-10-01
updated: 2026-10-01
sources: [raw/references/windows-login-validation-output.md]
status: active
---

## 一句话总结

登录验收流程后后台在线并成功回复微信普通消息，状态运行时间存在显示缺陷。

## 关键要点

- supervisor 与桥接均在线，重启计数为 0，消息循环已启动。
- 新日志记录 /ping、普通消息及对应模型回复。
- 9 月 30 日旧配置错误不代表本次启动失败。
- 两次初始化时间相隔约一分钟，用户输出未说明对应操作。
- 两个进程运行时间都显示 0s，需要核对时间转换。

## 与现有知识的关系

补充[登录任务账户排查](../queries/windows-task-logon-failure.md)与[人工验收说明](../queries/login-notification-validation.md)的用户运行证据。原始[脱敏摘录](../../raw/references/windows-login-validation-output.md)保持只读。

## 存疑或待跟进

本份输出没有模型失败通知结果，后续[模型故障验收](model-failure-validation-output.md)已由用户确认通过。仅凭两次初始化日志不能判定崩溃或重复运行；运行时间问题另见[Windows 运行时间时区错误](../queries/windows-process-uptime-timezone.md)。
