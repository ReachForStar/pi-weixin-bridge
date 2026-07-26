#Requires -Version 5.1
# Create no-window launcher shortcuts (double-click runs the .ps1 hidden).
# Run once: powershell -NoProfile -ExecutionPolicy Bypass -File create-shortcuts.ps1
$scriptDir = $PSScriptRoot
$WshShell = New-Object -ComObject WScript.Shell

function New-LauncherShortcut {
    param([string]$Name, [string]$TargetPs1)
    $lnkPath = Join-Path $scriptDir $Name
    $lnk = $WshShell.CreateShortcut($lnkPath)
    $lnk.TargetPath = "powershell.exe"
    $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$TargetPs1`""
    $lnk.WorkingDirectory = $scriptDir
    $lnk.Description = "pi-weixin-bridge"
    $lnk.Save()
    Write-Host "created: $lnkPath"
}

New-LauncherShortcut "start-pi-weixin-bridge.lnk" (Join-Path $scriptDir "start-service.ps1")
New-LauncherShortcut "stop-pi-weixin-bridge.lnk" (Join-Path $scriptDir "stop-service.ps1")
Write-Host "Done. Double-click the .lnk to start/stop with no console window."
