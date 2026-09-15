#Requires -Version 5.1
# pi-weixin-bridge: 停止后台 daemon（隐藏窗口，无控制台框）。
$ErrorActionPreference = "Stop"
$scriptDir = $PSScriptRoot
Start-Process -FilePath "node.exe" `
    -ArgumentList "`"$scriptDir\bin\pi-weixin-bridge.js`" daemon stop" `
    -WindowStyle Hidden `
    -WorkingDirectory $scriptDir
