#Requires -Version 5.1
# pi-weixin-bridge: 停止后台 daemon（隐藏窗口，无控制台框）。
$ErrorActionPreference = "Stop"
$scriptDir = $PSScriptRoot
$entryPoint = Join-Path $scriptDir "bin\pi-weixin-bridge.js"
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw "node.exe 未在 PATH 中找到" }
if (-not (Test-Path -LiteralPath $entryPoint)) { throw "入口文件不存在: $entryPoint" }
Start-Process -FilePath "node.exe" `
    -ArgumentList @("`"$entryPoint`"", "daemon", "stop") `
    -WindowStyle Hidden `
    -WorkingDirectory $scriptDir
