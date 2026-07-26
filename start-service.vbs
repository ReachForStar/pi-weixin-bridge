' start-service.vbs : launch pi-weixin-bridge via PM2 with a hidden window.
' Double-click to start in background, no console window appears.
' windowStyle=0 hides the window; PM2 daemon and app also use windowsHide.
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
WshShell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "npx pm2 start ecosystem.config.cjs", 0, False
