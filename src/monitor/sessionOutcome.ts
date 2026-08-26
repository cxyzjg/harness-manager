/**
 * 会话成效评估（闭环监控 - 会话轨迹/执行链的成效判断）
 *
 * 从会话的调用链 + token + 消息数评估"这次会话干成了没、成本如何"。
 * 输出成效分(0-100) + 等级(高/中/低) + 判断依据 + 改进建议。
 *
 * 评估维度:
 *  - 产出信号: 写/编辑类工具(写文件/改代码)次数, 计划完成类信号
 *  - 执行健康: 错误工具调用, 重试模式, 工具链是否完整(有读取→有修改)
 *  - 成本效率: token 总量, 每有效产出消耗, 消息/调用比
 *  - 规模: 调用次数, 会话长度(上下文规模)
 */
import type { Session, ToolCall } from "../types.js";

export type OutcomeLevel = "high" | "medium" | "low";

export interface SessionOutcome {
  sessionId: string;
  harness: string;
  startedAt?: string;
  project?: string;
  score: number; // 0-100
  level: OutcomeLevel;
  metrics: {
    toolCalls: number;
    messageCount: number;
    tokenTotal: number;
    writeActions: number; // 写/编辑类工具次数
    readActions: number; // 读/探索类
    errors: number; // 出错调用
    retries: number; // 重试模式次数
    lastTool: string | undefined;
  };
  signals: string[]; // 判断依据（人类可读）
  suggestions: string[]; // 改进建议
}

// 工具分类
const WRITE_TOOLS = new Set(["write", "edit", "apply_patch", "patch", "create", "insert", "delete"]);
const READ_TOOLS = new Set(["read", "ls", "find", "grep", "search", "cat", "view", "ffgrep", "fffind"]);
const PLAN_TOOLS = new Set(["plan_mode_complete", "plan_mode_question", "complete_plan", "complete"]);

export function evaluateSession(s: Session): SessionOutcome {
  const tools = s.tools;
  const errors = tools.filter((t) => t.error || String(t.output ?? "").toLowerCase().includes("error")).length;
  const writes = tools.filter((t) => WRITE_TOOLS.has(t.name)).length;
  const reads = tools.filter((t) => READ_TOOLS.has(t.name)).length;
  const plans = tools.filter((t) => PLAN_TOOLS.has(t.name)).length;
  const lastTool = tools.length ? tools[tools.length - 1].name : undefined;
  const retries = countRetries(tools);
  const tokenTotal = s.tokenUsage?.total ?? 0;

  // ---- 评分 ----
  let score = 50; // 基准分
  const signals: string[] = [];
  const suggestions: string[] = [];

  // 产出信号（写动作是"干了事"的最强信号）
  if (writes >= 3) { score += 20; signals.push(`有 ${writes} 次写/编辑动作，产出实质改动`); }
  else if (writes >= 1) { score += 10; signals.push(`有 ${writes} 次写/编辑动作`); }
  else { score -= 10; signals.push("无写/编辑动作，可能是纯分析/探索会话"); }

  // 计划完成信号
  if (plans > 0) { score += 10; signals.push("有规划完成信号(plan 类工具)"); }

  // 执行健康
  if (errors === 0) { score += 5; signals.push("无错误调用"); }
  else { score -= errors * 5; signals.push(`${errors} 次出错调用`); if (errors > 0) suggestions.push(`排查 ${errors} 次错误工具调用`); }
  if (retries > 0) { score -= retries * 3; signals.push(`${retries} 次重试模式`); if (retries > 0) suggestions.push("存在重复调用同一工具的情况，可能卡在循环"); }

  // 读取→修改的闭环（读过的项目有落地动作才算有效）
  if (reads > 0 && writes > 0) { score += 5; signals.push("读→写闭环完整"); }
  else if (reads > 0 && writes === 0) { score -= 5; signals.push("只读未写，可能停留在调研阶段"); }

  // 成本效率
  if (tokenTotal > 0) {
    const costPerWrite = writes > 0 ? tokenTotal / writes : 0;
    if (costPerWrite > 0 && costPerWrite > 200_000) {
      score -= 10; suggestions.push(`token 消耗高(每写动作 ${Math.round(costPerWrite)} token)，可能上下文冗长`);
    }
    if (s.messages > 0 && tools.length / s.messages < 0.3) {
      score -= 5; suggestions.push("工具调用占比低，可能有大量无效对话");
    }
  }

  // 规模惩罚（过大会话往往低效）
  if (tools.length > 200) { score -= 5; suggestions.push("调用次数过多(>200)，建议拆分会话"); }

  // 兜底错误过多
  if (errors >= 5) score -= 10;

  score = Math.max(0, Math.min(100, score));
  const level: OutcomeLevel = score >= 70 ? "high" : score >= 45 ? "medium" : "low";

  if (level === "high" && !suggestions.length) suggestions.push("整体健康，继续保持");
  if (score < 45) suggestions.push("建议复盘该会话的执行链(hm trace)定位瓶颈");

  return {
    sessionId: s.id,
    harness: s.harness,
    startedAt: s.startedAt,
    project: s.cwd,
    score,
    level,
    metrics: {
      toolCalls: tools.length,
      messageCount: s.messages,
      tokenTotal,
      writeActions: writes,
      readActions: reads,
      errors,
      retries,
      lastTool,
    },
    signals,
    suggestions,
  };
}

/** 检测重试模式：同一工具+相似输入在相邻位置重复 */
function countRetries(tools: ToolCall[]): number {
  let retries = 0;
  for (let i = 1; i < tools.length; i++) {
    const prev = tools[i - 1];
    const cur = tools[i];
    if (prev.name === cur.name && jsonEq(prev.input, cur.input)) retries++;
  }
  return retries;
}

function jsonEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** 批量评估所有会话，返回按分数排序 */
export function evaluateAll(sessions: Session[]): SessionOutcome[] {
  return sessions.map(evaluateSession).sort((a, b) => b.score - a.score);
}
