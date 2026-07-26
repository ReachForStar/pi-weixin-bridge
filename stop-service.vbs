' stop-service.vbs : stop pi-weixin-bridge with a hidden window.
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
WshShell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "npx pm2 stop pi-weixin-bridge", 0, False
