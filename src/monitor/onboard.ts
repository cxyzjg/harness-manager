/**
 * 新技能自动检测 + 询问迁移（单源共享 onboarding）
 *
 * 每次 scan 后对比基线，找出"新出现的技能"（用户新装到 ~/.agents/skills 等目录、
 * 尚未进入单源共享的），提示是否迁入单源。
 *
 * 基线存于 ~/.harness-manager/skill-baseline.json（单源技能名集合）。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../config.js";
import { loadCache, saveCache } from "../storage.js";
import type { HarnessResource } from "../types.js";

export interface NewSkillCandidate {
  name: string;
  path: string; // 源路径（如 ~/.agents/skills/<name>）
  source: string;
  scope: string;
  alreadyInSingleSource: boolean;
}

const BASELINE_FILE = "skill-baseline.json";

function baselinePath(): string {
  return join(dataDir(), BASELINE_FILE);
}

/** 读取单源目录中的技能名集合 */
export function singleSourceNames(repoRoot: string): Set<string> {
  const skillsDir = join(repoRoot, "skills");
  if (!existsSync(skillsDir)) return new Set();
  const names = new Set<string>();
  for (const n of readdirSync(skillsDir)) {
    const dir = join(skillsDir, n);
    if (!existsSync(join(dir, "SKILL.md")) && !existsSync(join(dir, "skill.md"))) continue;
    names.add(n);
  }
  return names;
}

/** 读取基线（上次单源技能集合 + 时间） */
export function loadBaseline(): { names: string[]; updatedAt?: string } {
  const p = baselinePath();
  if (!existsSync(p)) return { names: [] };
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return { names: [] };
  }
}

/** 保存基线 */
export function saveBaseline(names: Set<string>): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(
    baselinePath(),
    JSON.stringify({ names: [...names], updatedAt: new Date().toISOString() }, null, 2)
  );
}

/**
 * 检测新技能：不在基线、且不在单源目录、且非项目级/第三方包、且来源是用户目录。
 * @param resources 本次扫描的全部资源
 * @param repoRoot  仓库根（用于读单源目录）
 */
export function detectNewSkills(
  resources: HarnessResource[],
  repoRoot: string
): NewSkillCandidate[] {
  const singleNames = singleSourceNames(repoRoot);
  const baseline = loadBaseline();

  // 用户可装技能的位置（非包、非项目级）
  const userScoped = resources.filter(
    (r) =>
      (r.kind === "skill" || r.kind === "project-skill") &&
      r.source === "pi" &&
      r.scope === "global"
  );

  const out: NewSkillCandidate[] = [];
  for (const r of userScoped) {
    const alreadyInSingleSource = singleNames.has(r.name);
    const inBaseline = baseline.names.includes(r.name);
    // 新技能 = 之前基线里没有，且不在单源
    if (!inBaseline && !alreadyInSingleSource) {
      out.push({
        name: r.name,
        path: r.path,
        source: r.source,
        scope: r.scope,
        alreadyInSingleSource,
      });
    }
  }
  return out;
}

/**
 * 执行迁移：把新技能复制到单源目录，更新缓存状态。
 * @returns 迁移成功的技能名列表
 */
export async function migrateNewSkills(
  candidates: NewSkillCandidate[],
  repoRoot: string
): Promise<string[]> {
  const migrated: string[] = [];
  const singleNames = singleSourceNames(repoRoot);
  for (const c of candidates) {
    if (singleNames.has(c.name)) continue; // 已在单源，跳过
    const src = c.path;
    // 源是 SKILL.md 文件 → 目标目录
    if (existsSync(src)) {
      const targetDir = join(repoRoot, "skills", c.name);
      mkdirSync(targetDir, { recursive: true });
      if (existsSync(join(src, "SKILL.md")) || existsSync(join(src, "skill.md"))) {
        // src 是目录
        cpSync(src, targetDir, { recursive: true });
      } else {
        // src 是 SKILL.md 文件
        cpSync(src, join(targetDir, "SKILL.md"));
      }
      migrated.push(c.name);
      singleNames.add(c.name);
    }
  }

  // 更新缓存状态为 single-source
  if (migrated.length) {
    const cache = loadCache();
    if (cache) {
      for (const m of migrated) {
        for (const r of cache.resources) {
          if (r.name === m && r.source === "pi" && r.scope === "global") {
            r.source = "single-source";
            r.scope = "single-source";
            r.status = "migrated";
            r.migratedTo = `skills/${m}/`;
          }
        }
      }
      saveCache(cache);
    }
  }
  return migrated;
}
