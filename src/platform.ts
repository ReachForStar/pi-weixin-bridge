import { join } from "node:path";

export function windowsPowerShellPath(): string {
  if (!process.env.SystemRoot) throw new Error("缺少 SystemRoot，无法定位 Windows PowerShell");
  return join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}
