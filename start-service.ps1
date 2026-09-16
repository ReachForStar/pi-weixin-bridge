#Requires -Version 5.1
# pi-weixin-bridge: 启动后台 daemon（隐藏窗口，无控制台框）。
# 隐藏启动: powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File start-service.ps1
$ErrorActionPreference = "Stop"
$scriptDir = $PSScriptRoot
$entryPoint = Join-Path $scriptDir "bin\pi-weixin-bridge.js"
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw "node.exe 未在 PATH 中找到" }
if (-not (Test-Path -LiteralPath $entryPoint)) { throw "入口文件不存在: $entryPoint" }
# daemon start 以 detached + windowsHide 拉起 supervisor，本身无窗口；
# 这里 -WindowStyle Hidden 兜底短暂的 node 启动器进程。
# ArgumentList 用数组：路径含括号/空格时逐 token 处理，避免单字符串拼接断裂。
Start-Process -FilePath "node.exe" `
    -ArgumentList @("`"$entryPoint`"", "daemon", "start") `
    -WindowStyle Hidden `
    -WorkingDirectory $scriptDir
