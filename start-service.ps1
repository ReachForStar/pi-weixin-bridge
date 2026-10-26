#Requires -Version 5.1
# pi-weixin-bridge: 启动后台 daemon（隐藏窗口，无控制台框）。
# 隐藏启动: powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File start-service.ps1
param(
    [string]$NodePath,
    [string]$StateDir,
    [string]$Workspace,
    [string]$ModelRef,
    [string]$AgentDir
)
$ErrorActionPreference = "Stop"
if ($StateDir) { $env:PI_WEIXIN_STATE_DIR = $StateDir }
if ($Workspace) { $env:PI_WEIXIN_WORKSPACE = $Workspace }
if ($ModelRef) { $env:PI_WEIXIN_MODEL = $ModelRef }
if ($AgentDir) { $env:PI_CODING_AGENT_DIR = $AgentDir }
if (-not $NodePath) {
    $NodePath = (Get-Command node.exe -ErrorAction Stop).Source
}
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node 路径不存在: $NodePath" }
$scriptDir = $PSScriptRoot
$entryPoint = Join-Path $scriptDir "bin\pi-weixin-bridge.js"
if (-not (Test-Path -LiteralPath $entryPoint)) { throw "入口文件不存在: $entryPoint" }
# daemon start 以 detached + windowsHide 拉起 supervisor，本身无窗口；
# 这里 -WindowStyle Hidden 兜底短暂的 node 启动器进程。
# ArgumentList 用数组：路径含括号/空格时逐 token 处理，避免单字符串拼接断裂。
$launcher = Start-Process -FilePath $NodePath `
    -ArgumentList @("`"$entryPoint`"", "daemon", "start") `
    -WindowStyle Hidden `
    -WorkingDirectory $scriptDir `
    -Wait -PassThru
exit $launcher.ExitCode
