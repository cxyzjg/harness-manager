/**
 * 技能中文分类映射（对应 docs/SKILLS-GUIDE.md 的 8 大分类）
 */
export type SkillCategory =
  | "需求规划"
  | "设计架构"
  | "开发编码"
  | "质量调试"
  | "项目进度"
  | "协作交接"
  | "沟通写作"
  | "系统工具";

export const CATEGORY_ICON: Record<SkillCategory, string> = {
  需求规划: "📋",
  设计架构: "🎨",
  开发编码: "💻",
  质量调试: "🔍",
  项目进度: "📊",
  协作交接: "🤝",
  沟通写作: "📞",
  系统工具: "🛠",
};

/** 技能名 → 分类 */
export const SKILL_CATEGORY: Record<string, SkillCategory> = {
  // 需求与规划
  grilling: "需求规划",
  "grill-me": "需求规划",
  "grill-with-docs": "需求规划",
  "loop-me": "需求规划",
  "wait-what": "需求规划",
  "to-questionnaire": "需求规划",
  wayfinder: "需求规划",
  brainstorming: "需求规划",
  triage: "需求规划",
  // 设计与架构
  "codebase-design": "设计架构",
  "domain-modeling": "设计架构",
  "improve-codebase-architecture": "设计架构",
  prototype: "设计架构",
  "to-spec": "设计架构",
  "to-tickets": "设计架构",
  implement: "设计架构",
  "implement-spec": "设计架构",
  // 开发与编码
  tdd: "开发编码",
  "test-driven-development": "开发编码",
  scaffold: "开发编码",
  "scaffold-exercises": "开发编码",
  "setup-ts-deep-modules": "开发编码",
  "setup-pre-commit": "开发编码",
  "migrate-to-shoehorn": "开发编码",
  "using-git-worktrees": "开发编码",
  "resolving-merge-conflicts": "开发编码",
  // 质量与调试
  "code-review": "质量调试",
  review: "质量调试",
  "diagnosing-bugs": "质量调试",
  "systematic-debugging": "质量调试",
  "verification-before-completion": "质量调试",
  security: "质量调试",
  "audit-structure": "质量调试",
  debt: "质量调试",
  optimise: "质量调试",
  // 项目与进度
  status: "项目进度",
  brief: "项目进度",
  log: "项目进度",
  nextsteps: "项目进度",
  changes: "项目进度",
  staging: "项目进度",
  rollback: "项目进度",
  restart: "项目进度",
  wrapup: "项目进度",
  // 协作与交接
  handoff: "协作交接",
  "claude-handoff": "协作交接",
  retro: "协作交接",
  "dispatching-parallel-agents": "协作交接",
  teach: "协作交接",
  "ask-matt": "协作交接",
  wizard: "协作交接",
  // 沟通与写作
  "writing-for-agents": "沟通写作",
  "writing-plans": "沟通写作",
  "writing-skills": "沟通写作",
  "writing-beats": "沟通写作",
  "writing-fragments": "沟通写作",
  "writing-shape": "沟通写作",
  // 系统工具
  "find-skills": "系统工具",
  "manage-skills": "系统工具",
  "setup-matt-pocock-skills": "系统工具",
  "git-guardrails-claude-code": "系统工具",
  "using-superpowers": "系统工具",
  "run-tasks": "系统工具",
  "run-all-tasks": "系统工具",
  "task-status": "系统工具",
  cost: "系统工具",
  learned: "系统工具",
  memory: "系统工具",
  resume: "系统工具",
};

/** 获取技能分类（未知技能归为"系统工具"） */
export function categoryOf(name: string): SkillCategory {
  return SKILL_CATEGORY[name] ?? "系统工具";
}

export const ALL_CATEGORIES: SkillCategory[] = [
  "需求规划",
  "设计架构",
  "开发编码",
  "质量调试",
  "项目进度",
  "协作交接",
  "沟通写作",
  "系统工具",
];
