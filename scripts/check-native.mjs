import { createRequire } from "node:module";

// Windows 功能需要原生 COM 绑定，阻止 npm 将编译失败当作安装成功。
if (process.platform === "win32") createRequire(import.meta.url)("winax");
