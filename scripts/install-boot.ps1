#Requires -Version 5.1
# 注册每用户登录自启任务（免管理员）。参数: <Execute> <Argument>
# 注意：-AtLogOn 必须显式指定当前用户，否则任务按“任何用户登录”注册，需要管理员权限。
$ErrorActionPreference = "Stop"
$TaskName = "pi-weixin-bridge"
if ($args.Count -lt 2) { throw "用法: install-boot.ps1 <Execute> <Argument>" }
if (-not $env:USERDOMAIN -or -not $env:USERNAME) { throw "无法确定当前用户（USERDOMAIN/USERNAME 未设置）。请在交互式会话中运行此脚本。" }
if (-not (Test-Path -LiteralPath $args[0] -PathType Leaf)) { throw "可执行文件不存在: $args[0]" }
$action = New-ScheduledTaskAction -Execute $args[0] -Argument $args[1]
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "pi-weixin-bridge 后台服务自启（每用户登录，隐藏窗口）" -Force | Out-Null
Write-Host "已注册计划任务: $TaskName"
