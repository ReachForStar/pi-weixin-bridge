#!/usr/bin/env node
// npx 入口：用 tsx 程序化注册 ESM 加载器后运行 TS 源码，免去构建步骤。
import { register } from "tsx/esm/api";

register();
await import("../src/index.ts");
