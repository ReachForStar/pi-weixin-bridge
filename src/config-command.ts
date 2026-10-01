import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { Readable } from "node:stream";
import { CONFIG_FILE, STATE_DIR, WORKSPACE, MODEL_REF, loadSettings, saveSettings, resolveUserPath, validateSettings, type BridgeSettings } from "./config.js";
import { configuredModels } from "./models.js";
import { LineReader } from "./wizard.js";
import { daemonStatus } from "./daemon/daemon.js";

const fields = {
  model: "默认模型",
  stateDir: "状态目录",
  workspace: "默认工作目录",
  "access.admins": "管理员微信编号（JSON 数组）",
  "access.allowFrom": "允许访问的微信编号（JSON 数组）",
  "access.permission": "管理员权限：read-only / guarded / full",
  "budget.dailyTokens": "每日 Token 上限（正整数）",
  "budget.dailyCost": "每日成本上限（正数，按模型返回的成本计费单位）",
  "budget.timeZone": "日预算时区",
  maxFileBytes: "单文件字节上限（正整数）",
  projects: "项目配置（JSON 对象）",
  access: "访问权限配置（JSON 对象）",
  budget: "日预算配置（JSON 对象）",
} as const;
type Field = keyof typeof fields;
const jsonFields = new Set<Field>(["access.admins", "access.allowFrom", "projects", "access", "budget", "maxFileBytes", "budget.dailyTokens", "budget.dailyCost"]);

function fieldOf(value: string): Field {
  if (!Object.hasOwn(fields, value)) throw new Error(`不支持配置项 ${value}，请运行 config help 查看可用项`);
  return value as Field;
}

function getValue(settings: BridgeSettings, field: Field): unknown {
  const [parent, child] = field.split(".");
  const value = settings[parent as keyof BridgeSettings];
  return child ? (value as Record<string, unknown> | undefined)?.[child] : value;
}

function patchFor(settings: BridgeSettings, field: Field, value: unknown): BridgeSettings {
  const [parent, child] = field.split(".");
  if (!child) return { [parent!]: value };
  const current = parent === "access" ? settings.access ?? { admins: [], allowFrom: [], permission: "guarded" } : settings.budget ?? {};
  const next = { ...current } as Record<string, unknown>;
  if (value === undefined) delete next[child];
  else next[child] = value;
  // 删除管理员或白名单必须保留显式空列表，避免移除限制后开放全部访问。
  if (parent === "access" && (child === "admins" || child === "allowFrom") && value === undefined) next[child] = [];
  return { [parent!]: next };
}

function checkPath(value: string): string {
  const path = resolveUserPath(value);
  if (existsSync(path) && !statSync(path).isDirectory()) throw new Error("配置路径必须为目录");
  let parent = path;
  while (!existsSync(parent)) {
    const next = dirname(parent);
    if (next === parent) throw new Error("路径不存在可写的父目录");
    parent = next;
  }
  if (!statSync(parent).isDirectory()) throw new Error("路径的父目录不是目录");
  accessSync(parent, constants.W_OK);
  return path;
}

export async function setConfigValue(fieldName: string, raw?: string): Promise<void> {
  const field = fieldOf(fieldName);
  const settings = loadSettings();
  let value: unknown = raw;
  if (raw !== undefined) {
    if (!raw.trim()) throw new Error("配置值不能为空，恢复默认请使用 config unset");
    value = jsonFields.has(field) ? JSON.parse(raw) : raw.trim();
    if (field === "stateDir" || field === "workspace") value = checkPath(raw);
    if (field === "model") {
      const models = await configuredModels();
      const model = models.find((model) => model.ref === value);
      if (!model) throw new Error("模型不在 models.json 的供应方目录中，请运行 config models 查看");
    }
    if (field === "projects") {
      const probe = { ...settings, projects: value };
      validateSettings(probe);
      const projects = probe.projects!;
      const refs = Object.values(projects).flatMap((project) => project.model ? [project.model] : []);
      const models = refs.length ? await configuredModels() : [];
      for (const project of Object.values(projects)) {
        project.workspace = checkPath(project.workspace);
        if (project.model && !models.some((model) => model.ref === project.model)) throw new Error("项目模型不在 models.json 的供应方目录中");
      }
    }
  }
  if ((field === "stateDir" || field === "workspace") && daemonStatus().running) throw new Error("修改路径前请运行 pi-weixin-bridge daemon stop，避免后台使用旧目录");
  const patch = patchFor(settings, field, value);
  const next = { ...settings, ...patch };
  for (const key of Object.keys(next) as Array<keyof BridgeSettings>) if (next[key] === undefined) delete next[key];
  validateSettings(next);
  saveSettings(patch);
  console.log(`已${raw === undefined ? "恢复默认" : "保存"}：${field}（${CONFIG_FILE}）`);
  if (field === "stateDir") console.log("状态目录变更不会迁移账号、会话、日志与任务；旧目录保留，新目录需已有账号或重新登录。");
  if (field === "model" && raw === undefined) console.log("已移除保存的默认模型，启动前须重新选择模型或设置 PI_WEIXIN_MODEL。");
  if (field === "access" && raw === undefined) console.log("已移除访问限制，将恢复个人使用模式：所有联系人拥有完整权限。");
  if (field.startsWith("access.") && !next.access?.admins.length) console.log("管理员列表为空，受限访问模式下没有管理员；请配置 access.admins。");
  const variable = { stateDir: "PI_WEIXIN_STATE_DIR", workspace: "PI_WEIXIN_WORKSPACE", model: "PI_WEIXIN_MODEL" }[field as "stateDir" | "workspace" | "model"];
  if (variable && process.env[variable]) console.log(`${variable} 已设置，运行时仍优先使用环境变量。`);
  console.log("运行中的服务请执行 pi-weixin-bridge daemon restart 使配置完整生效；修改路径后需重新注册自启。");
}

function showConfig(): void {
  const settings = loadSettings();
  const saved = Object.fromEntries(Object.keys(fields).filter((field) => !field.includes(".")).map((field) => [field, getValue(settings, field as Field)]));
  console.log(JSON.stringify({ file: CONFIG_FILE, saved, effective: { stateDir: STATE_DIR, workspace: WORKSPACE, model: MODEL_REF || null }, overrides: Object.fromEntries(["PI_WEIXIN_STATE_DIR", "PI_WEIXIN_WORKSPACE", "PI_WEIXIN_MODEL"].filter((key) => process.env[key]).map((key) => [key, process.env[key]])) }, null, 2));
}

export function printConfigHelp(): void {
  console.log(`pi-weixin-bridge config [子命令]

  config                    交互式选择配置项，不扫码、不自动启动后台
  config show               查看已保存配置、实际路径/模型和环境变量覆盖
  config get <配置项>       查看保存值，未配置显示 null
  config set <配置项> <值>  校验后合并保存，路径与模型为字符串，数组/数字/对象为 JSON
  config unset <配置项>     恢复默认；清除管理员/白名单保留空数组
  config models             查看 models.json 中供应方与模型编号
  config model [编号或引用]  选择默认模型；省略参数时交互选择
  config help               查看帮助

配置项：
${Object.entries(fields).map(([key, label]) => `  ${key}  ${label}`).join("\n")}

示例：
  pi-weixin-bridge config models
  pi-weixin-bridge config model <供应方/模型>
  pi-weixin-bridge config set budget.dailyTokens 100000
  pi-weixin-bridge config set budget.timeZone Asia/Shanghai

环境变量优先。保存后请重启后台；修改路径前必须停止后台，旧账号/会话不会自动迁移。
移除 access 会恢复所有联系人完整权限；设置访问限制时必须配置管理员编号。
此命令不修改 pi models.json，不显示供应方密钥，不改变已有会话独立选择的模型。`);
}

async function chooseModel(reader: LineReader): Promise<void> {
  const models = await configuredModels();
  const providers = [...new Set(models.map((model) => model.provider))];
  providers.forEach((provider, index) => console.log(`${index + 1}. ${provider}`));
  const providerChoice = (await reader.question("选择供应方编号：")).trim();
  const provider = /^\d+$/.test(providerChoice) ? providers[Number(providerChoice) - 1] : undefined;
  if (!provider) throw new Error("供应方编号无效，配置未保存");
  const available = models.filter((model) => model.provider === provider);
  available.forEach((model, index) => console.log(`${index + 1}. ${model.id} — ${model.name}`));
  const choice = (await reader.question("选择默认模型编号：")).trim();
  const model = /^\d+$/.test(choice) ? available[Number(choice) - 1] : undefined;
  if (!model) throw new Error("模型编号无效，配置未保存");
  await setConfigValue("model", model.ref);
}

export async function runConfigCommand(args: string[], opts: { input?: Readable; interactive?: boolean } = {}): Promise<void> {
  const sub = args[0];
  if (sub === "help" || sub === "--help" || sub === "-h") { printConfigHelp(); return; }
  if (sub === "show") {
    if (args.length !== 1) throw new Error("用法：config show");
    showConfig(); return;
  }
  if (sub === "get") {
    if (args.length !== 2) throw new Error("用法：config get <配置项>");
    console.log(JSON.stringify(getValue(loadSettings(), fieldOf(args[1]!)) ?? null, null, 2)); return;
  }
  if (sub === "set" || sub === "unset") {
    if (args.length !== (sub === "set" ? 3 : 2)) throw new Error(`用法：config ${sub} <配置项>${sub === "set" ? " <值>" : ""}`);
    await setConfigValue(args[1]!, sub === "set" ? args[2]! : undefined); return;
  }
  if (sub === "models" || (sub === "model" && args[1])) {
    if (args.length !== (sub === "models" ? 1 : 2)) throw new Error(`config ${sub} 参数数量无效`);
    const models = await configuredModels();
    if (sub === "models") { models.forEach((model, index) => console.log(`${index + 1}. ${model.ref} — ${model.name}`)); return; }
    const choice = args[1]!;
    const model = /^\d+$/.test(choice) ? models[Number(choice) - 1] : models.find((model) => model.ref === choice);
    if (!model) throw new Error("模型引用或编号无效，请运行 config models 查看");
    await setConfigValue("model", model.ref); return;
  }
  if (sub !== undefined && sub !== "model") throw new Error("未知 config 子命令，请运行 config help");
  if (!(opts.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true))) {
    if (sub === "model") throw new Error("非交互模式请指定模型编号或引用：config model <供应方/模型>");
    showConfig(); printConfigHelp(); return;
  }
  const reader = new LineReader(opts.input ?? process.stdin);
  try {
    if (sub === "model") { await chooseModel(reader); return; }
    const choices = Object.keys(fields) as Field[];
    choices.forEach((field, index) => console.log(`${index + 1}. ${fields[field]}（${field}）`));
    console.log("0. 查看当前配置并退出");
    const selected = (await reader.question("选择配置项编号：")).trim();
    if (selected === "0" || !selected) { showConfig(); return; }
    const field = /^\d+$/.test(selected) ? choices[Number(selected) - 1] : undefined;
    if (!field) throw new Error("配置项编号无效，配置未保存");
    if (field === "model") { await chooseModel(reader); return; }
    console.log(`保存值：${JSON.stringify(getValue(loadSettings(), field) ?? null)}`);
    const value = await reader.question(`${fields[field]}（空输入取消）：`);
    if (!value.trim()) { console.log("已取消，配置未保存"); return; }
    await setConfigValue(field, value);
  } finally { reader.close(); }
}
