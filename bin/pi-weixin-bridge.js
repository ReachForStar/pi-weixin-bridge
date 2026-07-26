#!/usr/bin/env node
// npx 入口：用 tsx/esm/api 程序化注册 ESM 加载器后运行 TS 源码，免去构建步骤。
// 命令分发：start/serve（默认）前台运行桥接服务；install/login/stop/status/uninstall/help 交给 CLI。
import { register } from "tsx/esm/api";

register();

const args = process.argv.slice(2);
const command = args[0] ?? "start";

if (command === "start" || command === "serve") {
  await import("../src/index.ts");
} else {
  const { runCli } = await import("../src/cli.ts");
  await runCli(args);
}
