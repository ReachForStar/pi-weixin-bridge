---
title: 供应方读取与会话模型配置
type: entity
tags: [模型, 安装, 配置]
created: 2026-09-30
updated: 2026-09-30
status: active
---

## 职责

安装扫码后按用户 pi 配置选择默认模型，微信命令支持当前会话独立选择并保存。真实模型目录、交互输入流与会话偏好测试通过。

## 关键文件与接口

- src/models.ts：使用 SDK getAgentDir 定位 models.json，读取 providers 的实际供应方名称，再通过 ModelRuntime 的 getModels(provider) 获取模型；不列未配置供应方。供应方可沿用 SDK 内置模型目录，配置 errors 时拒绝继续。
- src/wizard.ts：runModelWizard 先选供应方编号，再选模型编号；saveSettings 合并保存安装默认值，保留路径、权限和预算配置。
- src/cli.ts：路径、扫码、模型选择、后台、快捷方式按顺序执行；help 说明模型目录、环境变量、安装选项和微信命令。
- src/features/service.ts：/model 显示当前会话，list 输出编号和引用；数字或 provider/modelId 切换当前会话。
- src/pi/sessions.ts：switchSessionModel 校验配置模型并保存会话偏好，reload 更新配置而保留各会话选择。
- src/features/policy.ts：会话模型优先于项目模型和安装默认；项目切换清除原会话覆盖。

## 上下游依赖

复用固定 pi SDK 0.82.0 的模型和鉴权接口。默认目录为 ~/.pi/agent，PI_CODING_AGENT_DIR 可覆盖；PI_WEIXIN_MODEL 优先于 config.json 的安装默认值。不向外部服务探测模型可用性，鉴权与网络是否可用以实际任务为准。

## 重要变更记录

取消固定 amax 默认值，未选择默认模型时明确要求完成 install 或配置环境变量。非交互模式不会任选第一个模型；已有默认或环境变量必须匹配 models.json。互动安装失败时不启动后台。模型编号对应当次列表，配置变化后应重新查看。

关联：[微信功能服务与权限](feature-services.md)、[后台守护进程](background-daemon.md)、[发布前人工确认](../decisions/manual-release-confirmation.md)。

## 验证与边界

测试使用 SDK 实际 OpenAI/Anthropic 模型目录及其 baseUrl，不构造虚假模型运行时；验证配置读取、供应方分组、选择后保留权限与预算、会话模型独立保存、非法编号与未选默认模型拒绝。安装仅读取配置，不自动探测模型网络或鉴权可用性。配置供应方不能使用空对象，SDK 要求至少指定 baseUrl、headers、compat、modelOverrides 或 models；getError 非空时拒绝继续。

环境变量覆盖保存的默认值；交互选择与环境变量不一致时提示该覆盖仍生效。/model list 通过当前配置创建目录，会话实际切换使用已初始化运行时，新配置应先 /reload。
