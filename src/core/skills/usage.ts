/**
 * 技能触发追踪（第4项）
 *
 * 从 realtime events.log 提取 skill_trigger 事件（pi extension 在
 * before_agent_start 记录：每用户回合已加载的技能 + 项目 + 提示词），
 * 聚合成技能触发统计：
 *  - 触发次数
 *  - 触发记录（时间/项目/场景/提示词）
 *  - 按技能/按项目/按时间聚合
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { LiveEvent } from "../sessions/realtime.js";

export interface SkillTrigger {
  ts: string;
  skills: string[];
  cwd?: string;
  prompt?: string;
}

export interface SkillUsageStats {
  totalTriggers: number;
  bySkill: Record<string, number>;
  byProject: Record<string, number>;
  byDate: Record<string, number>;
  recent: SkillTrigger[];
}

function usageLogPath(): string {
  return join(homedir(), ".harness-manager", "realtime", "events.log");
}

/** 读取全部触发事件 */
export function readSkillTriggers(max = 5000): SkillTrigger[] {
  const p = usageLogPath();
  if (!existsSync(p)) return [];
  try {
    const raw = readFileSync(p, "utf-8").split("\n").filter(Boolean);
    const triggers: SkillTrigger[] = [];
    for (const line of raw.slice(-max)) {
      try {
        const e = JSON.parse(line) as LiveEvent & { skills?: string[]; prompt?: string };
        if (e.type === "skill_trigger" && e.skills?.length) {
          triggers.push({ ts: e.ts, skills: e.skills, cwd: e.cwd, prompt: e.prompt });
        }
      } catch { /* skip */ }
    }
    return triggers;
  } catch {
    return [];
  }
}

/** 聚合触发统计 */
export function skillUsageStats(): SkillUsageStats {
  const triggers = readSkillTriggers();
  const bySkill: Record<string, number> = {};
  const byProject: Record<string, number> = {};
  const byDate: Record<string, number> = {};

  for (const t of triggers) {
    for (const s of t.skills) bySkill[s] = (bySkill[s] ?? 0) + 1;
    const proj = projectName(t.cwd);
    if (proj) byProject[proj] = (byProject[proj] ?? 0) + 1;
    const d = (t.ts ?? "").slice(0, 10);
    if (d) byDate[d] = (byDate[d] ?? 0) + 1;
  }

  return {
    totalTriggers: triggers.length,
    bySkill,
    byProject,
    byDate,
    recent: triggers.slice(-20).reverse(),
  };
}

function projectName(cwd?: string): string {
  if (!cwd) return "";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.slice(0, 3).join("/");
}
