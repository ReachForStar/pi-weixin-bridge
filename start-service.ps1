#Requires -Version 5.1
# pi-weixin-bridge: start via PM2 with a hidden window.
# Launch hidden: powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File start-service.ps1
$ErrorActionPreference = "Stop"
$scriptDir = $PSScriptRoot
# PM2 daemon/app already use windowsHide; -WindowStyle Hidden keeps the launcher console hidden too.
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npx pm2 start ecosystem.config.cjs" `
    -WindowStyle Hidden `
    -WorkingDirectory $scriptDir
