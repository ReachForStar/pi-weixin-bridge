---
title: Windows 登录任务注册账户错误
type: query
tags: [Windows, 自启, COM, 账户]
created: 2026-10-01
updated: 2026-10-01
sources: [raw/references/windows-task-registration-output.md]
status: active
---

## 问题

用户实际执行 daemon install-boot，RegisterTaskDefinition 返回 0x8007052e，后台未运行。来源为[终端摘录](../../raw/references/windows-task-registration-output.md)。附件旧日志不能证明本次启动结果。

## 根因

[Windows 错误码](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--1300-1699-)将 1326（0x52e）定义为账户或密码不正确。现有实现从环境变量组合 DOMAIN\\USERNAME，并将空字符串作为密码传入 COM。环境变量可能与实际进程账户不一致；空字符串也不是空 VARIANT。具体触发因素待真实注册核验，不从错误码直接推定用户密码错误或 Microsoft 账户类型。

## 解法

改为通过当前 Node 进程的 WMI GetOwnerSid 读取实际账户 SID，同时将 Principal、LogonTrigger 和注册账户固定为相同 SID；交互登录注册传递 null 密码，不请求或保存用户密码。WMI 返回值或 SID 无效立即失败。使用系统 TASK_VALIDATE_ONLY 核验真实任务定义，但不注册任务。

用户随后明确授权实际注册并保留任务。修复版 daemon install-boot 返回成功；通过 COM 读回已启用任务，确认账户对应当前进程所有者、交互登录类型为 3、当前用户登录触发器为 9，Node 路径、开发版入口与工作目录正确。任务计划程序可将 SID 规范化为账户名，读回核验通过 WMI 将名称关联到同一真实 SID，不按字符串形式判为不同用户。未触发任务或注销登录，任务保留供用户验收。

完整本地验证：160 项测试通过、2 项按平台跳过，类型检查、构建、npm 打包和 wiki 校验通过。首轮出现一次定时任务 JSON 文件 rename EPERM；第二轮完整执行未复现，原因未确认，不作为本次注册修复结论。

接口依据：[GetOwnerSid](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/getownersid-method-in-class-win32-process)、[RegisterTaskDefinition](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskfolder-registertaskdefinition)与已安装 winax README 的 null/VT_EMPTY 说明。TASK_VALIDATE_ONLY 仅检查定义，不能证明账户注册或登录执行成功。

## 涉及模块

[Windows 原生 COM](../entities/windows-native-com.md)、[后台守护进程](../entities/background-daemon.md)、[登录验收说明](login-notification-validation.md)。关键文件 scripts/windows-helper.js 与 test/shortcuts.test.ts。

## 复发预防

用户按登录验收流程返回的新输出显示后台在线、消息循环正常，并记录真实微信普通消息成功回复。见[登录后输出](../sources/windows-login-validation-output.md)。系统登录后的后台与普通消息处理已有实际证据，后续[模型连接失败通知](../sources/model-failure-validation-output.md)已验证；两次初始化的触发操作未说明。

身份从操作系统实际进程获取，不依赖可修改的环境变量。自动验证覆盖 SID 与触发器一致、系统定义校验；实际注册、系统注销登录和微信响应仍分别记录。版本保持 1.7.1，暂不发布。
