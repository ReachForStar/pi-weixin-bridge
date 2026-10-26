---
title: npm-token-check 无法创建提醒 issue 与令牌轮换
type: query
tags: [ci, npm, secrets, 令牌, 工作流]
created: 2026-10-26
updated: 2026-10-26
sources: []
status: active
---

# npm-token-check 无法创建提醒 issue 与令牌轮换

## 问题

`NPM_TOKEN` 到期后按流程重新生成并更新 secret，但每周一运行的 `NPM Token Health Check` 工作流连续两次（2026-10-12、2026-10-19）结论为 failure，日志报：

```
Unhandled error: HttpError: Resource not accessible by integration
```

即使令牌真的失效，也收不到自动提醒 issue。

## 根因

两个独立问题叠加：

1. **job 权限为空**：`check-token` job 写的是 `permissions: {}`，而最后一步 `actions/github-script` 要调用 `issues.create`。工作流级 token 默认权限被显式清空后，写 issue 返回 403（`Resource not accessible by integration`）。
2. **到期日未随令牌更新**：`TOKEN_EXPIRES` 是手写常量（原值 `2026-10-24`），换令牌时必须人工同步，否则日期判断永远命中 `expired` 分支。

`Evaluate token status` 步骤本身是成功的（`whoami` 实测有效），失败只在创建 issue 那一步，所以红灯位置容易误判为网络或令牌问题。

## 解法

给 job 加最小写权限，并同步到期日：

```yaml
  check-token:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    # 创建提醒 issue 需要 issues 写权限（此前为空权限导致 403）
    permissions:
      issues: write
    steps:
      ...
          TOKEN_EXPIRES: "2027-01-24"
```

只加 `issues: write`，其余步骤（checkout、setup-node、`npm whoami`）不需要额外权限。

令牌侧要求（Granular Access Token）：Packages 选 Read and write、**勾选 bypass 2FA**（CI 无交互，不勾必 401）、有效期与 `TOKEN_EXPIRES` 一致。

## 验证

- 手动触发工作流，run 40273392883 在修复合入提交上执行：成功，日志 `whoami=valid`、`status=ok`。
- `status=ok` 时 `Create reminder issue` 步骤按条件跳过，因此本次只证明 403 已消失；`issues: write` 真正写入 issue 要等下次 `status!=ok` 时才发生，尚未触发。

## 复发预防

- 换令牌时逐项核对：npm 页面到期日 → `TOKEN_EXPIRES` → `gh secret list` 的更新时间。
- 失败先按步骤定位：`Evaluate token status` 成功而 `Create reminder issue` 失败即为权限问题，不要先怀疑令牌。
- `permissions` 显式写空等于关闭全部写权限；新增会写 issue/Release 的步骤时要同步补权限。

## 涉及模块

- `.github/workflows/npm-token-check.yml`（健康检查与提醒）
- `.github/workflows/ci.yml`（publish job 同样用 `secrets.NPM_TOKEN`）
- 仓库 Settings → Secrets and variables → Actions 的 `NPM_TOKEN`

## 关联页面

- [npm 统一安装与版本分发](../decisions/npm-distribution.md) — npm 为唯一分发渠道，令牌失效直接阻断发布。
- [1.7.1 发布记录](release-1-7-1.md) — 发布流程与 registry 核验方式。
