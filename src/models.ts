import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";

export async function configuredModels(runtime?: ModelRuntime): Promise<Array<{ provider: string; id: string; name: string; ref: string }>> {
  const file = join(getAgentDir(), "models.json");
  if (!existsSync(file)) throw new Error(`未找到 ${file}，请先配置 pi 的供应方与模型`);
  const data: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data) || !("providers" in data) || !data.providers || typeof data.providers !== "object" || Array.isArray(data.providers)) throw new Error("models.json 缺少 providers 对象配置");
  const registry = runtime ?? await ModelRuntime.create();
  if (registry.getError()) throw new Error("pi 模型配置无法加载，请检查 models.json 的结构和供应方配置");
  const providers = Object.keys(data.providers);
  const models = providers.flatMap((provider) => registry.getModels(provider).map((model) => ({
    provider, id: model.id, name: model.name, ref: `${provider}/${model.id}`,
  })));
  if (!models.length) throw new Error("models.json 中没有可选模型，请检查供应方配置");
  return models;
}
