#Requires -Version 5.1
# 移除 pi-weixin-bridge 自启任务（不存在时视为成功）
$ErrorActionPreference = "Stop"
try {
    Unregister-ScheduledTask -TaskName "pi-weixin-bridge" -Confirm:$false | Out-Null
    Write-Host "已移除计划任务: pi-weixin-bridge"
} catch {
    if ($_.Exception.Message -match "not found|找不到|does not exist") {
        Write-Host "任务不存在，无需移除"
    } else {
        throw
    }
}
