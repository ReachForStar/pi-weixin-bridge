---
title: 用户 Windows 自启注册失败输出
type: source
tags: [Windows, 自启, 验收]
created: 2026-10-01
updated: 2026-10-01
sources: [raw/references/windows-task-registration-output.md]
status: active
---

## 一句话总结

实际自启注册返回账户错误，系统登录验收尚未开始。

## 关键要点

- daemon stop 显示服务未运行，后续 status 仍为未运行。
- RegisterTaskDefinition 返回 0x8007052e，注册失败。
- 日志末尾是 9 月 30 日的旧正常回复，不代表本次启动。
- 用户随后执行 uninstall-boot，输出已移除任务。

## 与现有知识的关系

补充[登录任务账户排查](../queries/windows-task-logon-failure.md)与[验收步骤](../queries/login-notification-validation.md)的实际故障证据。[原始摘录](../../raw/references/windows-task-registration-output.md)不包含账户与对话标识。

## 存疑或待跟进

后续修复已经用户授权真实注册并读回验证，见[账户错误排查](../queries/windows-task-logon-failure.md)；系统重新登录和模型失败通知仍待核验。该后续结果不改变原始故障输出。
