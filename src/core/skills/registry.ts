/**
 * 技能注册表（统一管理核心）
 *
 * 把所有技能（全局 ~/.agents/skills、~/.pi/agent/skills、包 node_modules 技能、
 * 单源 harness-manager/skills）纳入一个权威注册表 ~/.harness-manager/skill-registry.json。
 *
 * 每条记录: name / 来源 / 版本hash / 状态(active/disabled/duplicate) / 冲突处理(update/keep/ignore)
 * 冲突检测: 同名技能在不同来源内容不一致 → 需用户决定 更新/覆盖/忽略
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { dataDir } from "../../config.js";
import { categoryOf } from "./skillCategories.js";

export type SkillState = "active" | "disabled" | "duplicate" | "orphan";
export type ConflictAction = "update" | "keep" | "ignore";

export interface RegistrySkill {
  name: string;
  sources: {
    kind: "global" | "package" | "single-source" | "project";
    path: string;
    pkg?: string; // 包名（package 来源）
    versionHash: string; // 内容 hash，用于冲突检测
    updatedAt: string;
  }[];
  state: SkillState;
  category: string;
  cnName?: string;
  oneLiner?: string;
  usage?: string;
  conflict?: { exists: boolean; action?: ConflictAction; chosenPath?: string };
}

export interface Registry {
  version: number;
  updatedAt: string;
  skills: Record<string, RegistrySkill>;
}

const REGISTRY_FILE = "skill-registry.json";

function registryPath(): string {
  return join(dataDir(), REGISTRY_FILE);
}

export function loadRegistry(): Registry {
  const p = registryPath();
  if (!existsSync(p)) return { version: 1, updatedAt: new Date().toISOString(), skills: {} };
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return { version: 1, updatedAt: new Date().toISOString(), skills: {} };
  }
}

export function saveRegistry(r: Registry): void {
  mkdirSync(dataDir(), { recursive: true });
  r.updatedAt = new Date().toISOString();
  writeFileSync(registryPath(), JSON.stringify(r, null, 2));
}

/** 计算技能内容 hash（用于冲突检测） */
export function skillHash(skillDir: string): string {
  try {
    const md = join(skillDir, "SKILL.md");
    const mdLower = join(skillDir, "skill.md");
    const file = existsSync(md) ? md : existsSync(mdLower) ? mdLower : null;
    if (!file) return "no-file";
    const content = readFileSync(file, "utf-8");
    return createHash("sha256").update(content).digest("hex").slice(0, 12);
  } catch {
    return "err";
  }
}

/** 发现一个技能源（全局/包/单源目录下的技能目录） */
function collectSource(dir: string, kind: "global" | "package" | "single-source", pkg?: string): { name: string; path: string; kind: typeof kind; pkg?: string }[] {
  if (!existsSync(dir)) return [];
  const out: { name: string; path: string; kind: typeof kind; pkg?: string }[] = [];
  for (const n of readdirSync(dir)) {
    const full = join(dir, n);
    if (!existsSync(join(full, "SKILL.md")) && !existsSync(join(full, "skill.md"))) continue;
    out.push({ name: n, path: full, kind, pkg });
  }
  return out;
}

/** 扫描并重建注册表（合并所有来源 + 冲突检测） */
export function rebuildRegistry(repoRoot: string): Registry {
  const reg = loadRegistry();
  const home = homedir();
  const agent = join(home, ".pi", "agent");

  const found: { name: string; path: string; kind: "global" | "package" | "single-source"; pkg?: string }[] = [];

  // 1) 全局技能
  found.push(...collectSource(join(agent, "skills"), "global"));
  found.push(...collectSource(join(home, ".agents", "skills"), "global"));
  // 2) 单源技能
  found.push(...collectSource(join(repoRoot, "skills"), "single-source"));
  // 3) 包技能（superpowers 等 node_modules）
  const pkgBases = [join(agent, "npm", "node_modules")];
  for (const base of pkgBases) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      if (d.startsWith("@")) {
        const scopeDir = join(base, d);
        if (!existsSync(scopeDir)) continue;
        for (const sub of readdirSync(scopeDir)) {
          const pkgDir = join(scopeDir, sub);
          if (existsSync(join(pkgDir, "skills"))) {
            found.push(...collectSource(join(pkgDir, "skills"), "package", `${d}/${sub}`));
          }
        }
      } else {
        const pkgDir = join(base, d);
        if (existsSync(join(pkgDir, "skills"))) {
          found.push(...collectSource(join(pkgDir, "skills"), "package", d));
        }
      }
    }
  }

  // 合并进注册表（同名不同源 → 冲突）
  for (const f of found) {
    const hash = skillHash(f.path);
    const existing = reg.skills[f.name];
    const srcEntry = { kind: f.kind, path: f.path, pkg: f.pkg, versionHash: hash, updatedAt: new Date().toISOString() };

    if (!existing) {
      reg.skills[f.name] = {
        name: f.name,
        sources: [srcEntry],
        state: "active",
        category: categoryOf(f.name),
        conflict: undefined,
      };
      continue;
    }

    // 同名已有：检测是否同一来源（避免重复）
    const sameSource = existing.sources.find((s) => s.path === f.path);
    if (sameSource) {
      sameSource.versionHash = hash;
      sameSource.updatedAt = new Date().toISOString();
      continue;
    }

    // 同名不同来源 → 冲突或合并
    const sameContent = existing.sources.some((s) => s.versionHash === hash);
    existing.sources.push(srcEntry);
    if (!sameContent) {
      existing.conflict = {
        exists: true,
        action: existing.conflict?.action ?? "keep",
        chosenPath: existing.conflict?.chosenPath,
      };
    }
  }

  // 标记孤儿（来源目录已不存在的技能）
  for (const [name, skill] of Object.entries(reg.skills)) {
    const alive = skill.sources.some((s) => existsSync(s.path));
    if (!alive) skill.state = "orphan";
  }

  saveRegistry(reg);
  return reg;
}

/** 解决冲突：用户选择 更新/覆盖/忽略 */
export function resolveConflict(reg: Registry, name: string, action: ConflictAction, chosenPath?: string): Registry {
  const skill = reg.skills[name];
  if (!skill) return reg;
  if (!skill.conflict) return reg;
  skill.conflict.action = action;
  skill.conflict.chosenPath = chosenPath;
  // 更新 = 采用新源；覆盖 = 保持现有；忽略 = 保持但不提示
  saveRegistry(reg);
  return reg;
}
