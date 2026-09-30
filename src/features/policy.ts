import { existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { loadSettings, WORKSPACE, MODEL_REF, STATE_DIR } from "../config.js";
import { ScopedState } from "./state.js";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type Permission = "read-only" | "guarded" | "full";
export interface ProjectProfile {
  workspace: string;
  model?: string;
  permission?: Permission;
  tools?: string[];
  skills?: string[];
}
interface Selection { project?: string; model?: string }

export class Policy {
  private readonly choices = new ScopedState<Selection>("preferences", () => ({}));
  identity(user: string): { allowed: boolean; admin: boolean; permission: Permission } {
    const access = loadSettings().access;
    if (!access) return { allowed: true, admin: true, permission: "full" };
    if (!Array.isArray(access.admins) || !Array.isArray(access.allowFrom)) throw new Error("access 必须设置 admins 和 allowFrom 数组");
    const admin = access.admins.includes(user);
    return { allowed: admin || access.allowFrom.includes(user), admin,
      permission: admin ? (access.permission ?? "guarded") : "read-only" };
  }
  profile(key: string, user: string): ProjectProfile & { name: string; model: string; permission: Permission } {
    const settings = loadSettings();
    const selected = this.choices.get(key);
    const name = selected.project ?? "default";
    const configured = name === "default" ? undefined : settings.projects?.[name];
    if (name !== "default" && !configured) throw new Error("所选项目已从配置中移除，请用 /project default 切换");
    const role = this.identity(user);
    const permission = !role.admin ? "read-only" : configured?.permission ?? role.permission;
    if (!["read-only", "guarded", "full"].includes(permission)) throw new Error("项目权限配置无效");
    return { ...configured, name, workspace: resolve(configured?.workspace ?? WORKSPACE),
      model: selected.model ?? configured?.model ?? MODEL_REF, permission };
  }
  projects(): string[] { return ["default", ...Object.keys(loadSettings().projects ?? {})]; }
  selectedProject(key: string): string { return this.choices.get(key).project ?? "default"; }
  select(key: string, name: string): void {
    if (!this.projects().includes(name)) throw new Error("项目不存在，请用 /project 查看已配置项目");
    this.choices.set(key, { project: name });
  }
  setModel(key: string, model: string): void {
    this.choices.set(key, { ...this.choices.get(key), model });
  }
  maxFileBytes(): number {
    const value = loadSettings().maxFileBytes ?? 20 * 1024 * 1024;
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("maxFileBytes 必须为正整数");
    return value;
  }
}

export async function checkedPath(path: string, workspace: string, fileOnly = true): Promise<string> {
  const root = await realpath(workspace);
  const target = await realpath(resolve(workspace, path));
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) throw new Error("路径超出当前项目目录");
  if (fileOnly && !(await stat(target)).isFile()) throw new Error("只能发送普通文件");
  return target;
}

export function diagnostics(): string {
  const settings = loadSettings();
  return ["🩺 本地诊断（不上传数据、不修改配置）", "",
    `- Node：${process.versions.node}`,
    `- 状态目录：${existsSync(STATE_DIR) ? "存在" : "未创建"}`,
    `- 默认工作目录：${existsSync(WORKSPACE) ? "存在" : "不存在"}`,
    `- 模型配置：${existsSync(join(getAgentDir(), "models.json")) ? "存在" : "未找到"}`,
    `- 访问限制：${settings.access ? "已配置" : "未配置，按原有个人使用模式运行"}`,
    `- 项目配置：${Object.keys(settings.projects ?? {}).length} 个`,
    "- anydoc：固定依赖 0.2.4；扫描 OCR 必须单独确认",
    "- 网络：此诊断不发送模型请求；模型和微信连通性以实际任务与服务日志为准",
  ].join("\n");
}
