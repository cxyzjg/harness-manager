/**
 * 技能触发效果关联 (阶段4收尾②)
 *
 * 回答: "用了技能 X 的会话, 成效是否更好?"
 *
 * 关联模型: skill_trigger(cwd, ts, skills) × session(started_at 邻近 + cwd 匹配) → 会话成效
 * 输出: 每技能 [触发次数 / 关联会话数 / 平均成效分(有outcome则用) / 可靠性等级分布] vs 全局基线
 */
import { join } from "node:path";
import { dataDir } from "../../config.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

export interface SkillEffect {
  skill: string;
  triggers: number; // 总触发次数
  linkedSessions: number; // 关联到的会话数
  avgOutcome?: number; // 关联会话平均成效分(0-100)
  baselineAvg: number; // 全局会话平均成效分
  delta?: number; // avg - baseline (正=该技能与会话高成效正相关)
  grades: Record<string, number>;
}

interface TriggerEv {
  ts: string;
  skills: string[];
  cwd?: string;
}

/** 读 realtime events.log 的 skill_trigger */
function readTriggers(eventsPath?: string): TriggerEv[] {
  const p = eventsPath ?? join(dataDir(), "realtime", "events.log");
  try {
    return readFileSync(p, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((e): e is TriggerEv => !!e && e.type === "skill_trigger" && Array.isArray(e.skills))
      .map((e) => ({ ts: e.ts, skills: e.skills, cwd: e.cwd }));
  } catch {
    return [];
  }
}

export interface SessionLite {
  id: string;
  harness: string;
  started_at?: string;
  cwd?: string;
  score?: number; // 成效分(可缺)
  grade?: string;
}

/**
 * 计算技能效果关联。
 * @param sessions 统一库的会话(带时间/cwd)
 * @param outcomeOf sessionId -> 成效分(0-100)
 */
export function linkSkillEffects(sessions: SessionLite[], outcomeOf: Map<string, number>, eventsPath?: string): SkillEffect[] {
  const triggers = readTriggers(eventsPath);
  if (!triggers.length) return [];

  // 会话索引: 按 cwd 尾段 + 时间邻近匹配 trigger -> session
  const baseScores = sessions.map((s) => outcomeOf.get(s.id)).filter((x): x is number => x != null);
  const baseline = baseScores.length ? +(baseScores.reduce((a, b) => a + b, 0) / baseScores.length).toFixed(1) : 0;

  const perSkill = new Map<string, { triggers: number; scores: number[]; grades: Record<string, number> }>();
  for (const t of triggers) {
    for (const sk of t.skills) {
      const rec = perSkill.get(sk) ?? { triggers: 0, scores: [], grades: {} };
      rec.triggers++;
      perSkill.set(sk, rec);
    }
    // 找同 cwd 且时间在 trigger 前2小时~后12小时内的最近会话 → 把其成效归因给本trigger全部技能
    const norm = (p?: string): string => (p ?? "").replace(/[\\/]+$/, "");
    const cand = sessions
      .filter((s) => s.started_at && norm(s.cwd) === norm(t.cwd))
      .map((s) => ({ s, diff: Math.abs(new Date(s.started_at!).getTime() - new Date(t.ts).getTime()) }))
      .filter((x) => x.diff < 12 * 3600_000)
      .sort((a, b) => a.diff - b.diff)[0];
    if (cand) {
      const score = outcomeOf.get(cand.s.id);
      if (score != null) {
        for (const sk of t.skills) {
          const rec = perSkill.get(sk)!;
          rec.scores.push(score);
        }
      }
      void cand;
    }
  }

  const out: SkillEffect[] = [];
  for (const [skill, rec] of perSkill) {
    const avg = rec.scores.length ? +(rec.scores.reduce((a, b) => a + b, 0) / rec.scores.length).toFixed(1) : undefined;
    out.push({
      skill,
      triggers: rec.triggers,
      linkedSessions: rec.scores.length,
      avgOutcome: avg,
      baselineAvg: baseline,
      delta: avg != null ? +(avg - baseline).toFixed(1) : undefined,
      grades: rec.grades,
    });
  }
  return out.sort((a, b) => (b.delta ?? -999) - (a.delta ?? -999));
}
