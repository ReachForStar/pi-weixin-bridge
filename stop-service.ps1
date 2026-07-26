#Requires -Version 5.1
# pi-weixin-bridge: stop via PM2 with a hidden window.
$ErrorActionPreference = "Stop"
$scriptDir = $PSScriptRoot
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npx pm2 stop pi-weixin-bridge" `
    -WindowStyle Hidden `
    -WorkingDirectory $scriptDir
