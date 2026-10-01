# Windows 登录任务注册输出摘录

来源：用户于 2026-10-01 提供的终端文本附件。以下只摘录与注册故障直接相关的输出；用户路径、账号与对话标识未纳入本文件。

```text
node bin/pi-weixin-bridge.js daemon stop
服务未在运行

node bin/pi-weixin-bridge.js daemon install-boot
命令执行失败: Windows 系统工具执行失败（退出码 1）：DispInvoke: RegisterTaskDefinition: OLE error 0x8007052e 发生意外。

node bin/pi-weixin-bridge.js status
桥接状态: 未运行

node bin/pi-weixin-bridge.js daemon uninstall-boot
已移除计划任务 pi-weixin-bridge
```

附件中的 bridge.log 末尾记录时间为 2026-09-30T16:03:43.860Z，包含一次模型正常回复；此前有多次未选择默认模型导致的初始化失败。附件未包含本次成功注册、系统重新登录或模型故障通知的验证输出。
