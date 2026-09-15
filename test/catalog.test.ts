import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// catalog：skill 发现（agentDir/skills + ~/.agents/skills，按名去重）与 mcp.json 解析。
// 全部指向临时目录，不触碰真实 ~/.pi/agent。
function writeSkill(dir: string, name: string, description: string): void {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nbody\n`,
    "utf8",
  );
}

describe("catalog", () => {
  let home: string;
  let agentDir: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "piwx-catalog-"));
    agentDir = join(home, "agent");
    mkdirSync(agentDir, { recursive: true });
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("HOME", home);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv("PI_WEIXIN_STATE_DIR", join(home, "state"));
    vi.stubEnv("PI_WEIXIN_WORKSPACE", join(home, "ws"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  async function catalog() {
    vi.resetModules();
    return import("../src/catalog.js");
  }

  it("listSkills：发现 agentDir 与 ~/.agents/skills，按名去重", async () => {
    writeSkill(join(agentDir, "skills"), "demo-skill", "演示技能（用户级）");
    writeSkill(join(home, ".agents", "skills"), "shared-skill", "共享技能");
    // 同名技能：agentDir 优先
    writeSkill(join(home, ".agents", "skills"), "demo-skill", "应被去重掉");

    const { listSkills } = await catalog();
    const skills = listSkills();
    expect(skills.map((s) => s.name).sort()).toEqual(["demo-skill", "shared-skill"]);
    const demo = skills.find((s) => s.name === "demo-skill")!;
    expect(demo.description).toBe("演示技能（用户级）");
    expect(demo.filePath).toContain(join(agentDir, "skills", "demo-skill", "SKILL.md"));
  });

  it("listSkills：无 skill 目录时返回空", async () => {
    const { listSkills } = await catalog();
    // WORKSPACE 为真实值，但其 .pi/skills 不存在；agentDir 与 ~/.agents/skills 均为空
    expect(listSkills()).toEqual([]);
  });

  it("listMcpServers：解析 mcp.json（name + command + args）", async () => {
    writeFileSync(
      join(agentDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "demo-mcp": { command: "demo", args: ["--flag"], env: {} },
          plain: { command: "plain" },
        },
      }),
      "utf8",
    );
    const { listMcpServers } = await catalog();
    expect(listMcpServers()).toEqual([
      { name: "demo-mcp", command: "demo --flag" },
      { name: "plain", command: "plain" },
    ]);
  });

  it("listMcpServers：无 mcp.json / 损坏时返回空", async () => {
    const { listMcpServers } = await catalog();
    expect(listMcpServers()).toEqual([]);
    writeFileSync(join(agentDir, "mcp.json"), "{bad json", "utf8");
    expect(listMcpServers()).toEqual([]);
  });

  it("指令文本：skill / mcp 各含名称", async () => {
    const { skillDirective, mcpDirective } = await catalog();
    expect(skillDirective({ name: "cnki", description: "", filePath: "/x/SKILL.md" })).toContain("cnki");
    expect(skillDirective({ name: "cnki", description: "", filePath: "/x/SKILL.md" })).toContain("/x/SKILL.md");
    expect(mcpDirective({ name: "qmd", command: "qmd mcp" })).toContain("qmd");
  });
});
