/**
 * 技能中文说明库：每个技能的中文名 + 一句话 + 使用提示
 * 供 CLI `hm skill <name>` / Web 资源页 / 场景推荐使用。
 */
import { categoryOf } from "./skillCategories.js";

export interface SkillInfo {
  name: string;
  category: ReturnType<typeof categoryOf>;
  cnName: string; // 中文名
  oneLiner: string; // 一句话说明
  usage: string; // 怎么用/何时用
}

const INFOS: Record<string, Omit<SkillInfo, "category" | "name">> = {
  // ---- 需求规划 ----
  grilling: { cnName: "拷问设计", oneLiner: "连环追问把方案逼问清楚", usage: "动手前想验证设计是否靠谱时使用，会让你重新审视假设" },
  "grill-me": { cnName: "拷问入口", oneLiner: "转发到 grilling 的入口", usage: "简单触发设计拷问，无工作目录时用" },
  "grill-with-docs": { cnName: "拷问+留档", oneLiner: "拷问同时产出 ADR/术语表", usage: "有工作目录时推荐用，边设计边留下决策痕迹" },
  "loop-me": { cnName: "流程拷问", oneLiner: "针对要建的流程反复拷问规格", usage: "有模糊的流程想法想变清晰需求" },
  "wait-what": { cnName: "重讲一遍", oneLiner: "停下要求重讲没说明白的话", usage: "需求/指令含糊时，让对话回到正轨" },
  "to-questionnaire": { cnName: "需求问卷", oneLiner: "把决策变问卷给别人填", usage: "需求要问别人/收集意见时" },
  wayfinder: { cnName: "决策地图", oneLiner: "超大工程拆成决策地图", usage: "多会话大项目，规划全貌和里程碑" },
  brainstorming: { cnName: "头脑风暴", oneLiner: "开放式探索该做什么", usage: "从零开始、需求未定时的发散思考" },
  triage: { cnName: "问题分诊", oneLiner: "把 issue/PR 分类验证排优先级", usage: "一堆待办要理清轻重缓急" },
  // ---- 设计架构 ----
  "codebase-design": { cnName: "深模块设计", oneLiner: "设计模块接口/可测性", usage: "设计或重构模块边界时" },
  "domain-modeling": { cnName: "领域建模", oneLiner: "打磨领域模型写 CONTEXT/ADR", usage: "建立项目领域词汇、记录关键决策" },
  "improve-codebase-architecture": { cnName: "架构体检", oneLiner: "扫描代码找改进点出报告", usage: "想评估架构质量时" },
  prototype: { cnName: "原型验证", oneLiner: "一次性代码验证想法", usage: "不确定方案时先快速试" },
  "to-spec": { cnName: "转技术规格", oneLiner: "把对话写成规格文档", usage: "需求已明确要出正式规格" },
  "to-tickets": { cnName: "拆工单", oneLiner: "把计划/规格拆成工单", usage: "任务拆分、排执行顺序" },
  implement: { cnName: "实现", oneLiner: "按规格/工单写代码", usage: "正式开发实现时" },
  "implement-spec": { cnName: "按规格实现", oneLiner: "专门按规格文档实现", usage: "有 spec 要落地代码时" },
  // ---- 开发编码 ----
  tdd: { cnName: "测试驱动", oneLiner: "红-绿-重构循环", usage: "写功能先写测试" },
  "test-driven-development": { cnName: "测试驱动(备)", oneLiner: "TDD 备选版", usage: "同 tdd" },
  scaffold: { cnName: "项目脚手架", oneLiner: "生成标准项目结构", usage: "新项目起步" },
  "scaffold-exercises": { cnName: "练习脚手架", oneLiner: "建练习题目录结构", usage: "做课程/练习题" },
  "setup-ts-deep-modules": { cnName: "TS深模块配置", oneLiner: "配置 dependency-cruiser", usage: "TS 项目架构落地" },
  "setup-pre-commit": { cnName: "提交钩子", oneLiner: "配 Husky pre-commit", usage: "提交前自动格式化/检查/测试" },
  "migrate-to-shoehorn": { cnName: "测试重构", oneLiner: "as 断言改 shoehorn", usage: "测试代码现代化" },
  "using-git-worktrees": { cnName: "git worktree", oneLiner: "隔离风险改动", usage: "想安全搞实验不污染主目录" },
  "resolving-merge-conflicts": { cnName: "合并冲突", oneLiner: "解决 git 冲突", usage: "merge/rebase 冲突时" },
  // ---- 质量调试 ----
  "code-review": { cnName: "代码审查", oneLiner: "双轴审查(规范+需求)", usage: "审查分支/PR" },
  review: { cnName: "快速审查", oneLiner: "按约定结构审查", usage: "快速 code review" },
  "diagnosing-bugs": { cnName: "bug诊断", oneLiner: "硬 bug/性能诊断循环", usage: "出 bug 时系统性排查" },
  "systematic-debugging": { cnName: "系统化调试", oneLiner: "假设驱动调试", usage: "疑难 bug 用假设-验证循环" },
  "verification-before-completion": { cnName: "完成前验证", oneLiner: "先跑检查再宣称完成", usage: "收尾前验证" },
  security: { cnName: "安全审计", oneLiner: "查密钥/注入等风险", usage: "安全体检" },
  "audit-structure": { cnName: "结构审计", oneLiner: "对照标准审计结构", usage: "一致性检查" },
  debt: { cnName: "技术债", oneLiner: "技术债审计排优先级", usage: "技术债盘点" },
  optimise: { cnName: "优化扫描", oneLiner: "冗余/死代码清理", usage: "代码清理" },
  // ---- 项目进度 ----
  status: { cnName: "健康快照", oneLiner: "快速项目现状", usage: "中途了解进度" },
  brief: { cnName: "项目简报", oneLiner: "一页项目概述", usage: "新人 onboarding/回顾" },
  log: { cnName: "进度日志", oneLiner: "构建状态写 buildplan", usage: "更新进度文档" },
  nextsteps: { cnName: "下一步", oneLiner: "推导接下来任务", usage: "不知道下一步做啥" },
  changes: { cnName: "变更记录", oneLiner: "会话改动记录", usage: "记录本次改动" },
  staging: { cnName: "部署staging", oneLiner: "发布到 staging", usage: "上线前" },
  rollback: { cnName: "安全回滚", oneLiner: "撤销上次提交/部署", usage: "出错要撤" },
  restart: { cnName: "会话续接", oneLiner: "恢复上次上下文", usage: "新会话续接" },
  wrapup: { cnName: "会话收尾", oneLiner: "提交+下一步+变更", usage: "结束一天" },
  // ---- 协作交接 ----
  handoff: { cnName: "交接文档", oneLiner: "对话压成交接给 agent", usage: "换 agent/续作" },
  "claude-handoff": { cnName: "交接CC", oneLiner: "交接给 Claude Code", usage: "跨工具交接" },
  retro: { cnName: "回顾", oneLiner: "编码会话复盘", usage: "回顾会" },
  "dispatching-parallel-agents": { cnName: "并行分发", oneLiner: "子任务并行给多 agent", usage: "任务可拆分并行" },
  teach: { cnName: "教学", oneLiner: "教你新技能/概念", usage: "想学习" },
  "ask-matt": { cnName: "技能路由", oneLiner: "推荐哪个技能/流程", usage: "不确定用哪个技能" },
  wizard: { cnName: "交互向导", oneLiner: "生成 bash 向导", usage: "需要人工步骤的向导" },
  // ---- 沟通写作 ----
  "writing-for-agents": { cnName: "面向agent写作", oneLiner: "写 AGENTS.md 等", usage: "写文档给 AI 看" },
  "writing-plans": { cnName: "写计划", oneLiner: "多步骤执行计划", usage: "复杂改动先写计划" },
  "writing-skills": { cnName: "编技能", oneLiner: "编写/改进 skill", usage: "造新技能" },
  "writing-beats": { cnName: "写作节奏", oneLiner: "素材编排成节奏", usage: "创作" },
  "writing-fragments": { cnName: "写作片段", oneLiner: "写作探索", usage: "创作" },
  "writing-shape": { cnName: "写作结构", oneLiner: "写作结构设计", usage: "创作" },
  // ---- 系统工具 ----
  "find-skills": { cnName: "找技能", oneLiner: "发现/安装技能", usage: "想找新技能" },
  "manage-skills": { cnName: "资源管理", oneLiner: "管理技能/工具/资源", usage: "harness-manager 核心，资源盘点/迁移/去重" },
  "setup-matt-pocock-skills": { cnName: "技能套件安装", oneLiner: "配置 mattpocock 套件", usage: "首次安装" },
  "git-guardrails-claude-code": { cnName: "git安全钩子", oneLiner: "拦危险 git 命令", usage: "防误操作" },
  "using-superpowers": { cnName: "套件引导", oneLiner: "superpowers 引导", usage: "会话启动参考" },
  "run-tasks": { cnName: "跑任务", oneLiner: "批量执行任务", usage: "批量任务" },
  "run-all-tasks": { cnName: "跑全部任务", oneLiner: "执行所有任务", usage: "批量任务" },
  "task-status": { cnName: "任务状态", oneLiner: "查看任务状态", usage: "任务管理" },
  cost: { cnName: "成本", oneLiner: "用量/成本查看", usage: "CC 侧成本" },
  learned: { cnName: "学习沉淀", oneLiner: "会话学习记录", usage: "CC 记忆" },
  memory: { cnName: "记忆", oneLiner: "会话记忆", usage: "CC 记忆" },
  resume: { cnName: "续接", oneLiner: "恢复会话", usage: "CC 续接" },
};

export function skillInfo(name: string): SkillInfo | undefined {
  const base = INFOS[name];
  if (!base) return undefined;
  return { name, category: categoryOf(name), ...base };
}

export function allSkillInfos(): SkillInfo[] {
  return Object.keys(INFOS).map((n) => skillInfo(n)!);
}
