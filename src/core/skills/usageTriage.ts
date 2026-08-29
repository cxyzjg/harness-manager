/**
 * 技能使用度分诊 (阶段补充③: 记录从没被真正用过的技能, 便于清理)
 *
 * 分级(基于实时extension的skill_trigger统计 + 注册表状态):
 *   active-used     : 有触发记录, 状态active -> 保留
 *   active-unused   : 无触发记录但状态active -> 候选清理(可一键禁用)
 *   low-usage       : 触发<2次 -> 观察
 *   disabled        : 已被禁用 -> 可考虑删除目录
 *
 * 数据源: realtime/events.log 的 skill_trigger + disabled-skills.json + 单源目录
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../../config.js";
import { homedir } from "node:os";
import { getDisabledSkills } from "./control.js";

export interface SkillUsageTriage {
  skill: string;
  triggerCount: number; // 从events.log统计
  state: "active-used" | "active-unused" | "low-usage" | "disabled";
  inSingleSource: boolean;
  cnName?: string;
}

function readTriggers(): Record<string, number> {
  const p = join(dataDir(), "realtime", "events.log");
  const bySkill: Record<string, number> = {};
  if (!existsSync(p)) return bySkill;
  try {
    for (const line of readFileSync(p, "utf-8").split("\n").filter(Boolean)) {
      try {
        const e = JSON.parse(line);
        if (e.type === "skill_trigger" && Array.isArray(e.skills)) {
          for (const sk of e.skills) bySkill[sk] = (bySkill[sk] ?? 0) + 1;
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return bySkill;
}

/**
 * 分诊: 单源目录全部技能 + 触发统计 + 禁用名单
 * @param repoRoot 仓库根(读 skills/ 目录)
 */
export function triageSkillUsage(repoRoot: string): SkillUsageTriage[] {
  const triggers = readTriggers();
  const disabled = new Set(getDisabledSkills());
  const skillsDir = join(repoRoot, "skills");
  const names = existsSync(skillsDir)
    ? readdirSync(skillsDir).filter((n) => existsSync(join(skillsDir, n, "SKILL.md")) || existsSync(join(skillsDir, n, "skill.md")))
    : [];

  const out: SkillUsageTriage[] = [];
  for (const n of names) {
    const count = triggers[n] ?? 0;
    let state: SkillUsageTriage["state"];
    if (disabled.has(n)) state = "disabled";
    else if (count >= 2) state = "active-used";
    else if (count === 1) state = "low-usage";
    else state = "active-unused";
    out.push({ skill: n, triggerCount: count, state, inSingleSource: true });
  }
  // 排序: 未使用优先, 再按触发数
  const order = { "active-unused": 0, "low-usage": 1, disabled: 2, "active-used": 3 };
  return out.sort((a, b) => order[a.state] - order[b.state] || a.triggerCount - b.triggerCount);
}
