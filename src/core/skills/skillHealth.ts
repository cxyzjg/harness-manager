/**
 * 技能健康监控（闭环监控 - skills 的管理/监控/维护/使用）
 *
 * 从资源目录 + 状态 + 描述质量评估每个技能的健康度，
 * 输出健康分(0-100) + 等级 + 维护动作建议。
 *
 * 评估维度:
 *  - 状态健康: active/candidate/duplicate/superseded
 *  - 重复风险: 是否被检测为去重候选
 *  - 描述质量: 有 description 且长度合理(可被自动发现)
 *  - 来源可信: 来源(单源/包/全局/项目)
 *  - 加载风险: 同名冲突
 */
import type { HarnessResource } from "../../types.js";
import { detectDupes } from "./dedupe.js";

export type HealthLevel = "healthy" | "attention" | "risk";

export interface SkillHealth {
  resource: HarnessResource;
  score: number; // 0-100
  level: HealthLevel;
  issues: string[]; // 问题
  actions: string[]; // 维护动作建议
}

export function assessSkillHealth(resources: HarnessResource[]): SkillHealth[] {
  const dupes = detectDupes(resources);
  // 同名冲突（强信号）——精确匹配
  const sameNameDupes = new Set<string>();
  for (const d of dupes) {
    if (d.kind === "same-name") d.names.forEach((n) => sameNameDupes.add(n.split("@")[0]));
  }
  // 功能重叠（弱信号）——仅作为提示，不重扣
  const overlapNames = new Set<string>();
  for (const d of dupes) {
    if (d.kind === "overlap") d.names.forEach((n) => overlapNames.add(n.split("@")[0]));
  }

  const out: SkillHealth[] = [];
  for (const r of resources) {
    if (r.kind !== "skill" && r.kind !== "project-skill") continue;
    let score = 70;
    const issues: string[] = [];
    const actions: string[] = [];

    // 状态
    if (r.status === "active") score += 10;
    else if (r.status === "candidate") { score -= 10; issues.push("候选重复状态"); actions.push("拍板去重决策(hm apply)"); }
    else if (r.status === "duplicate-of" || r.status === "superseded-by") {
      score -= 30; issues.push(`已被标记 ${r.status}`); actions.push("确认是否删除/归档");
    }

    // 同名冲突（重扣）
    if (sameNameDupes.has(r.name)) {
      score -= 20; issues.push("存在同名资源冲突"); actions.push("核对同名资源，决定保留哪个");
    }
    // 功能重叠（轻提示）
    else if (overlapNames.has(r.name)) {
      score -= 5; issues.push("与近似技能存在功能重叠"); actions.push("可考虑合并或明确分工");
    }

    // 描述质量
    const desc = r.description ?? "";
    if (!desc) { score -= 15; issues.push("缺少 description(无法被自动发现)"); actions.push("补充 description"); }
    else if (desc.length < 20) { score -= 8; issues.push("描述过短"); actions.push("扩充 description 到 20+ 字符"); }

    // 来源可信
    if (r.source === "single-source") score += 5;
    else if (r.source === "package") score += 3; // 随包升级，可维护

    // 项目级特殊
    if (r.scope === "project") {
      score += 2; // 项目级定位明确
    }

    score = Math.max(0, Math.min(100, score));
    const level: HealthLevel = score >= 75 ? "healthy" : score >= 50 ? "attention" : "risk";

    if (!issues.length && level === "healthy") actions.push("保持现状");
    if (actions.length === 0 && level !== "healthy") actions.push("review 后决定");

    out.push({ resource: r, score, level, issues, actions });
  }

  return out.sort((a, b) => a.score - b.score); // 最差在前
}

/** 汇总健康报告：健康/需关注/风险 计数 + 待维护动作 */
export function healthSummary(health: SkillHealth[]) {
  const byLevel = { healthy: 0, attention: 0, risk: 0 };
  const actions: string[] = [];
  for (const h of health) {
    byLevel[h.level]++;
    h.actions.forEach((a) => actions.push(`[${h.resource.name}] ${a}`));
  }
  return {
    total: health.length,
    byLevel,
    actions: [...new Set(actions)].slice(0, 30),
  };
}
