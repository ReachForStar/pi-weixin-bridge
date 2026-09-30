---
title: 后台守护进程
type: entity
tags: [后台, 进程, 可靠性]
created: 2026-09-30
updated: 2026-09-30
status: active
---

## 职责

维持桥接子进程，处理重复启动、停止、崩溃退避和登录等待。已通过 Windows 隔离状态目录中的实际启动、停止和再次启动验证。

## 关键文件与接口

- src/daemon/daemon.ts：异步启动和停止，释放日志描述符，停止失败保留 PID 文件并抛错。
- src/daemon/supervisor.ts：独占 PID 锁，运行期间检测停止请求并结束子进程；退出释放监听器、锁和 PID。
- src/daemon/process-lock.ts：独占写入进程锁，回收残留锁时重新检查存活进程；损坏锁明确报错。
- src/index.ts：桥接实例独占锁，从初始化到退出统一释放；微信上下文按账号分别保存。
- src/cli.ts：等待启动、停止和重启结果；更新依赖失败不继续宣称更新成功。

## 上下游依赖

Node 标准库和 Windows taskkill 或 POSIX 信号。测试只操作临时目录中的自有子进程，不变更用户实际自启任务。

## 重要变更记录

检查发现同步启动等待阻塞事件分发、supervisor 停止请求没有主动结束长运行子进程、PID 检查后写入存在竞态、日志文件描述符未关闭。真实子进程验证了运行期间停止、崩溃退避和重复实例拒绝；后台状态区分初始化、等待登录和消息循环已启动。

关联：[桥接运行可靠性](bridge-reliability.md)、[发布前人工确认](../decisions/manual-release-confirmation.md)。

## 验证与边界

141 项测试通过、1 项 Windows 不适用权限测试跳过，类型检查和构建通过。实际 bin 命令在 tmp 隔离目录启动 supervisor 和桥接服务；没有账号时进入等待登录，重复 daemon start 不改变 PID，前台重复实例退出失败，停止后可再次启动。仅操作自有测试进程，未注册或卸载用户实际自启任务。

Windows 自启使用绝对 PowerShell 与 Node 路径，保存路径及 pi 配置目录参数；隐藏启动器等待并传递退出码。PowerShell AST 语法检查通过。Linux unit 内容测试覆盖 Type=forking、PIDFile、引号与 ExecStop，实际 Linux/systemd 注册未执行。

损坏 PID 锁拒绝启动，不自行删除未知锁；残留 .reclaim 回收锁需要核对所属进程后由维护者处理。PID 标识并非操作系统持久进程身份，用户不应手动写入其他进程 PID。日志轮转在子进程重新启动前检查，长期不中断运行时需要维护日志容量。
