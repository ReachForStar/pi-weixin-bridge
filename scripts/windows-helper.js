import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const script = fileURLToPath(import.meta.url);
function arg(index) {
  if (index >= args.length) throw new Error("缺少 Windows 接口参数");
  return args[index];
}
function quote(value) {
  if (/["\r\n\x00]/.test(value)) throw new Error("Windows 接口参数包含无效字符");
  return '"' + value.replace(/\\+$/, (suffix) => suffix + suffix) + '"';
}
function launcher(offset) {
  return quote(script) + " run " + args.slice(offset).map(quote).join(" ");
}
try {
  const operation = arg(0);
  if (operation === "run") {
    const mode = arg(3);
    if (mode !== "start" && mode !== "stop") throw new Error("后台操作无效");
    const env = { ...process.env, PI_WEIXIN_STATE_DIR: arg(4), PI_WEIXIN_WORKSPACE: arg(5) };
    if (arg(6)) env.PI_WEIXIN_MODEL = arg(6);
    if (arg(7)) env.PI_CODING_AGENT_DIR = arg(7);
    const result = spawnSync(arg(1), [arg(2), "daemon", mode], { env, stdio: "inherit", windowsHide: true, timeout: 60_000 });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } else {
    const winax = createRequire(import.meta.url)("winax");
    const shell = new winax.Object("WScript.Shell");
    function readShortcut(file) {
      const application = new winax.Object("Shell.Application");
      const folder = application.NameSpace(dirname(file));
      if (!folder) throw new Error("快捷方式目录不存在");
      const item = folder.ParseName(basename(file));
      if (!item) throw new Error("快捷方式文件不存在");
      return item.GetLink;
    }
    if (operation === "shortcuts") {
      const root = arg(1);
      const bin = join(root, "bin", "pi-weixin-bridge.js");
      if (!existsSync(bin) || !existsSync(arg(2))) throw new Error("启动入口不存在");
      const template = join(dirname(script), "templates", "node-launcher.lnk");
      if (!existsSync(template)) throw new Error("快捷方式模板不存在");
      for (const mode of ["start", "stop"]) {
        const file = join(root, mode + "-pi-weixin-bridge.lnk");
        // ShellLinkObject 接收 Unicode 路径，避免旧 WSH Save 按系统代码页转换文件名。
        const link = readShortcut(template);
        const entry = mode + "-pi-weixin-bridge.cjs";
        const parameters = [script, "run", arg(2), bin, mode, arg(3), arg(4), arg(5), arg(6)];
        // ShellLinkObject 的参数读取存在长度限制，将配置保存在 Node 启动文件中。
        writeFileSync(join(root, entry), 'const result = require("node:child_process").spawnSync(process.execPath, ' + JSON.stringify(parameters) + ', { stdio: "inherit", windowsHide: true, timeout: 60000 });\nif (result.error) throw result.error;\nprocess.exitCode = result.status ?? 1;\n', "utf8");
        link.Path = arg(2);
        link.Arguments = quote(entry);
        link.WorkingDirectory = root;
        link.ShowCommand = 7;
        link.Save(file);
        if (!existsSync(file)) throw new Error("快捷方式未生成");
      }
    } else if (operation === "task-preview" || operation === "task-install") {
      const service = new winax.Object("Schedule.Service");
      service.Connect();
      const task = service.NewTask(0);
      const user = shell.ExpandEnvironmentStrings("%USERDOMAIN%\\%USERNAME%");
      task.RegistrationInfo.Description = "pi-weixin-bridge";
      task.Principal.UserId = user;
      task.Principal.LogonType = 3;
      task.Principal.RunLevel = 0;
      task.Settings.DisallowStartIfOnBatteries = false;
      task.Settings.StopIfGoingOnBatteries = false;
      task.Settings.ExecutionTimeLimit = "PT0S";
      task.Settings.RestartCount = 3;
      task.Settings.RestartInterval = "PT1M";
      const trigger = task.Triggers.Create(9);
      trigger.UserId = user;
      const action = task.Actions.Create(0);
      action.Path = arg(1);
      action.Arguments = launcher(1);
      action.WorkingDirectory = dirname(dirname(script));
      if (operation === "task-preview") console.log(String(task.XmlText));
      else service.GetFolder("\\").RegisterTaskDefinition("pi-weixin-bridge", task, 6, user, "", 3);
    } else if (operation === "task-remove") {
      const service = new winax.Object("Schedule.Service");
      service.Connect();
      const folder = service.GetFolder("\\");
      const tasks = folder.GetTasks(0);
      for (let i = 1; i <= Number(tasks.Count); i++) {
        if (String(tasks.Item(i).Name) === "pi-weixin-bridge") { folder.DeleteTask("pi-weixin-bridge", 0); break; }
      }
    } else if (operation === "stats") {
      const pid = Number(arg(1));
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("进程编号无效");
      const locator = new winax.Object("WbemScripting.SWbemLocator");
      const wmi = locator.ConnectServer(".", "root\\cimv2");
      const processes = wmi.ExecQuery("SELECT KernelModeTime,UserModeTime,WorkingSetSize,CreationDate FROM Win32_Process WHERE ProcessId=" + pid);
      if (Number(processes.Count)) {
        const item = processes.ItemIndex(0);
        const started = new winax.Object("WbemScripting.SWbemDateTime");
        started.Value = String(item.CreationDate);
        console.log([(Number(item.KernelModeTime) + Number(item.UserModeTime)) / 10000000, Number(item.WorkingSetSize), Math.max(0, (Date.now() - new Date(started.GetVarDate()).getTime()) / 1000)].join("\t"));
      }
    } else if (operation === "inspect-shortcut") {
      const link = readShortcut(arg(1));
      console.log(String(link.Path));
      console.log(String(link.Arguments));
      console.log(String(link.WorkingDirectory));
      console.log(Number(link.ShowCommand));
    } else throw new Error("Windows 接口操作无效");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
