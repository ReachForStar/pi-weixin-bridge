---
title: 登录自启与模型失败通知验收
type: query
tags: [Windows, 自启, 通知, 验证]
created: 2026-10-01
updated: 2026-10-01
status: active
---

## 问题

用户询问如何验证真实登录自启和真实微信中的模型失败通知。以下步骤已用于开发版人工验收，实际结果见后续材料引用。1.7.1 未发布，npm 当前安装不能直接当作本次修复版；开发版使用已构建工作区的 node bin/pi-weixin-bridge.js 入口。

## 根因与验证范围

后续[用户验收输出](../sources/windows-login-validation-output.md)显示后台在线并成功回复普通消息，登录后的后台运行和普通模型请求已有实际证据。输出中的 uptime=0s 已定位为[WMI 时间转换错误](windows-process-uptime-timezone.md)，不能据此判定持续重启。

用户首次实际注册返回 0x8007052e；后续修复身份和密码参数，经用户授权已真实注册成功并保留任务，COM 读回验证通过。登录验收流程后提供的输出确认后台与普通请求正常，见[账户错误排查](windows-task-logon-failure.md)。

[真实模型失败验收](../sources/model-failure-validation-output.md)已通过：Connection error. 后用户确认微信收到失败提示，/ping 正常回复；恢复配置并再次 /reload 后回复“测试成功”。本次覆盖模型连接失败，未扩展为所有供应方错误或微信网络故障均已验证。

任务定义生成不代表任务已注册或登录时能启动；通知生命周期测试不代表真实微信已收到供应方请求失败通知。必须检查实际后台状态及微信消息。Windows 注册会创建或覆盖当前用户的 pi-weixin-bridge 计划任务，daemon stop 会暂停消息处理；模型故障测试临时影响所选供应方的全部会话。

## 解法

### Windows 登录自启

先保存其他工作并确保没有正在运行的微信任务。当前工作区执行 node bin/pi-weixin-bridge.js daemon stop，再执行 node bin/pi-weixin-bridge.js daemon install-boot。在系统任务计划程序检查 pi-weixin-bridge：触发器是当前用户登录，程序为绝对 Node 路径，参数包含 windows-helper.js run 及真实配置路径，不包含旧 PowerShell 脚本。

退出 Windows 用户登录并重新登录；这与桥接 login 扫码绑定命令不同。登录后不手动启动服务，等待初始化后执行 node bin/pi-weixin-bridge.js status 与 node bin/pi-weixin-bridge.js daemon logs 100。通过判据为 supervisor 与桥接进程正常、消息循环已启动、没有重复实例或持续崩溃重启，微信 /ping 及普通消息均有回复；重新绑定二维码不应成为每次系统登录的必要步骤。可重复注销登录确认稳定性。任务计划程序的成功退出码只代表启动命令完成，还需核验后台与微信响应。

开发版任务记录工作区的绝对路径，验证期间不能移动工作区或切换 Node 安装；完成后执行 node bin/pi-weixin-bridge.js daemon uninstall-boot 移除测试注册。该操作不会停止已运行后台，是否停止需另外执行 daemon stop。以后使用正式 npm 安装入口重新注册自启。

### 模型失败通知

先在微信发送 /model 查看实际供应方，发送 /ping 并验证普通消息正常。备份实际 pi 配置目录的 models.json，默认位于用户主目录 .pi/agent/models.json，PI_CODING_AGENT_DIR 可覆盖。不要修改桥接账号凭据。

在备份后将所选供应方的 baseUrl 临时改为 http://127.0.0.1:1/v1，使用未运行模型服务的本机地址触发真实连接失败。若当前模型含单独 baseUrl 覆盖，也应指向该地址。这是请求故障注入，不伪造模型回复；微信网络保持正常。在微信发送 /reload 并确认会话配置更新成功，必要时重新 /model 选择刚修改的原模型。发送普通模型请求“请回复测试成功”。等待 SDK 请求和重试结束。

通过判据为收到“⚠️ 本次任务处理失败，请检查模型配置和服务日志后重试。”，而不是无限等待；daemon logs 100 记录本地端点请求错误，/history 记录失败，随后 /ping 仍正常。不存在固定的失败到达时限，取决于模型 SDK 重试。若模型依然正常回复，需要核对实际会话模型、重载结果和模型级 baseUrl 覆盖。

无论验收结果如何，恢复 models.json 备份并再次 /reload，确认普通请求恢复成功。不要用整机断网测试模型失败通知，因为微信投递也会同时失败。日志分享前检查并移除密钥、账号标识与用户消息。

## 涉及模块

[后台守护进程](../entities/background-daemon.md)、[供应方与模型配置](../entities/model-configuration.md)、[对话恢复与通知](../entities/conversation-recovery.md)、[GitHub 已知问题](github-issues-review.md)。接口依据 src/daemon/boot.ts、scripts/windows-helper.js、src/pi/sessions.ts、src/bridge.ts 以及已安装 pi SDK 的 docs/models.md。

## 复发预防

分别记录任务注册、系统重新登录、正常回复、失败通知、配置恢复结果。未执行步骤保持待核验；仅收到测试说明或自动测试通过不能将 Issue 标为用户环境已解决。
