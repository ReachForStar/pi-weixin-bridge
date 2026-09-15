#Requires -Version 5.1
# pi-weixin-bridge: 启动后台 daemon（隐藏窗口，无控制台框）。
# 隐藏启动: powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File start-service.ps1
$ErrorActionPreference = "Stop"
$scriptDir = $PSScriptRoot
# daemon start 以 detached + windowsHide 拉起 supervisor，本身无窗口；
# 这里 -WindowStyle Hidden 兜底短暂的 node 启动器进程。
Start-Process -FilePath "node.exe" `
    -ArgumentList "`"$scriptDir\bin\pi-weixin-bridge.js`" daemon start" `
    -WindowStyle Hidden `
    -WorkingDirectory $scriptDir
