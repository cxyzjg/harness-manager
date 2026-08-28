/**
 * 模型使用统计与评估 (阶段6 前置: "如何判别模型好坏" 的量化实现)
 *
 * 评估哲学: 单指标会骗人(token少可能因为没干活), 因此用三维加权:
 *   效率(30%): 每turn平均token(越低越好) —— 衡量表达效率
 *   质量(45%): 错误率(低好) / 重试率(低好) / 空转率(低好) / 写动作占比(高好=推动任务)
 *   稳定(25%): 成效分均值(高好)
 *
 * 重要约束: 模型对比只在"同项目/相似任务"下才有意义, 因此提供 per-project 分组对比。
 * 每个聚合分都给出下钻路径(具体会话), 避免数字骗自己。
 */
import { getDb } from "../db/store.js";

export interface ModelEval {
  model: string;
  sessions: number;
  turns: number;
  tools: number;
  // 效率
  tokensIn: number;
  tokensOut: number;
  tokensTotal: number;
  tokensPerTurn: number | null;
  // 质量
  errorRate: number;
  retryRate: number;
  emptyTurnRate: number;
  writeActionRatio: number | null; // 写动作/总工具(产出推动力)
  // 稳定
  avgOutcome: number | null;
  grades: Record<string, number>;
  // 综合
  score: number | null; // 0-100
  sampleNote: string; // 样本量提示(数据少时不可信)
}

const WRITE_SET = new Set(["write", "edit", "apply_patch", "patch"]);

export function evaluateModels(): { models: ModelEval[]; globalBaseline: { errorRate: number; retryRate: number; emptyTurnRate: number } } {
  const d = getDb();

  // 按模型聚合基础量
  const rows = d
    .prepare(`
      SELECT COALESCE(c.model, s.model, 'unknown') AS model,
             c.session_id,
             SUM(c.input_tokens) AS tin, SUM(c.output_tokens) AS tout
      FROM costs c
      LEFT JOIN sessions s ON s.id = c.session_id
      GROUP BY COALESCE(c.model, s.model, 'unknown'), c.session_id
    `)
    .all() as { model: string; session_id: string; tin: number; tout: number }[];

  const perModel = new Map<string, {
    sessions: Set<string>;
    turns: number;
    tools: number;
    errors: number;
    retries: number;
    emptyTurns: number;
    writes: number;
    tin: number;
    tout: number;
    outcomeScores: number[];
    grades: Record<string, number>;
  }>();

  const get = (m: string) =>
    perModel.get(m) ?? {
      sessions: new Set<string>(), turns: 0, tools: 0, errors: 0, retries: 0,
      emptyTurns: 0, writes: 0, tin: 0, tout: 0, outcomeScores: [] as number[], grades: {} as Record<string, number>,
    };

  // tokens 按 (model, session)
  for (const r of rows) {
    const rec = get(r.model);
    rec.tin += r.tin;
    rec.tout += r.tout;
    rec.sessions.add(r.session_id);
    perModel.set(r.model, rec);
  }

  // 全库逐会话细粒度(turn/tool/error/retry/empty/write), 归到会话模型
  const sessModel = d
    .prepare(`SELECT s.id, COALESCE(c.model, s.model, 'unknown') AS model
              FROM sessions s LEFT JOIN costs c ON c.session_id = s.id GROUP BY s.id`)
    .all() as { id: string; model: string }[];
  const modelOfSession = new Map(sessModel.map((r) => [r.id, r.model]));

  const allSessions = d.prepare("SELECT id FROM sessions").all() as { id: string }[];
  const turnsStmt = d.prepare("SELECT COUNT(*) n FROM turns WHERE session_id=?");
  const toolsStmt = d.prepare("SELECT name, is_error FROM tool_calls WHERE session_id=?");
  const emptyStmt = d.prepare(`
    SELECT COUNT(*) n FROM turns t WHERE t.session_id=?
      AND NOT EXISTS (SELECT 1 FROM thinkings th WHERE th.turn_id=t.id)
      AND NOT EXISTS (SELECT 1 FROM tool_calls tc WHERE tc.turn_id=t.id)`);

  for (const s of allSessions) {
    const model = modelOfSession.get(s.id) ?? "unknown";
    const rec = get(model);
    const tn = (turnsStmt.get(s.id) as { n: number }).n;
    rec.turns += tn;
    rec.emptyTurns += (emptyStmt.get(s.id) as { n: number }).n;
    const tcs = toolsStmt.all(s.id) as { name: string; is_error: number }[];
    rec.tools += tcs.length;
    for (const tc of tcs) {
      if (tc.is_error) rec.errors++;
      if (WRITE_SET.has(tc.name)) rec.writes++;
    }
    // 重试: 相邻同名同参
    const siblings = d
      .prepare(`SELECT name, input FROM tool_calls WHERE session_id=? ORDER BY started_at`)
      .all(s.id) as { name: string; input: unknown }[];
    for (let i = 1; i < siblings.length; i++) {
      if (siblings[i].name === siblings[i - 1].name && String(siblings[i].input) === String(siblings[i - 1].input)) rec.retries++;
    }
    perModel.set(model, rec);
  }

  // 成效分与等级(从 outcome 计算; 这里读取持久化的派生分数: 简化——按会话错误/空转重算轻量版)
  const outcomeStmt = d.prepare(`
    SELECT
      (SELECT COUNT(*) FROM tool_calls tc WHERE tc.session_id = s.id) AS tools,
      (SELECT COALESCE(SUM(tc.is_error),0) FROM tool_calls tc WHERE tc.session_id = s.id) AS errors
    FROM sessions s WHERE s.id = ?
  `);
  for (const s of allSessions) {
    const model = modelOfSession.get(s.id) ?? "unknown";
    const rec = get(model);
    const o = outcomeStmt.get(s.id) as { tools: number; errors: number };
    // 轻量成效: 错误率惩罚制(与metrics口径一致的简化)
    const errRate = o.tools ? o.errors / o.tools : 0;
    const score = Math.max(0, Math.min(100, 100 - errRate * 400));
    rec.outcomeScores.push(score);
    const grade = score >= 85 ? "A" : score >= 65 ? "B" : score >= 40 ? "C" : "D";
    rec.grades[grade] = (rec.grades[grade] ?? 0) + 1;
    perModel.set(model, rec);
  }

  // 全局基线
  const g = [...perModel.values()].reduce(
    (acc, r) => ({ errors: acc.errors + r.errors, tools: acc.tools + r.tools, retries: acc.retries + r.retries, empty: acc.empty + r.emptyTurns, turns: acc.turns + r.turns }),
    { errors: 0, tools: 0, retries: 0, empty: 0, turns: 0 }
  );
  const baseline = {
    errorRate: g.tools ? +(g.errors / g.tools).toFixed(3) : 0,
    retryRate: g.tools ? +(g.retries / g.tools).toFixed(3) : 0,
    emptyTurnRate: g.turns ? +(g.empty / g.turns).toFixed(3) : 0,
  };

  // 组装 + 评分
  const models: ModelEval[] = [];
  for (const [model, r] of perModel) {
    const nSessions = r.sessions.size;
    const turns = r.turns || 0;
    const tokensTotal = r.tin + r.tout;
    const tools = r.tools || 0;
    const errRate = tools ? r.errors / tools : 0;
    const retRate = tools ? r.retries / tools : 0;
    const empRate = turns ? r.emptyTurns / turns : 0;
    const writeRatio = tools ? r.writes / tools : null;
    const tokensPerTurn = turns ? Math.round(tokensTotal / turns) : null;
    const avgOutcome = r.outcomeScores.length
      ? +(r.outcomeScores.reduce((a, b) => a + b, 0) / r.outcomeScores.length).toFixed(1)
      : null;

    // 综合分: 效率30 + 质量45 + 稳定25
    // 效率: tokensPerTurn 相对值(无绝对好坏, 用对数降权; 样本少时不计)
    let effPart: number | null = null;
    if (tokensPerTurn != null && turns >= 3) {
      // 归一化到 0-100: 5k token/turn = 80分, 20k = 40分 (对数曲线)
      effPart = Math.max(0, Math.min(100, 100 - Math.log10(Math.max(1, tokensPerTurn) / 1000) * 60));
    }
    const qualityPart = Math.max(0, Math.min(100,
      100 - errRate * 300 - retRate * 150 - empRate * 80 + (writeRatio ?? 0) * 40
    ));
    const stablePart = avgOutcome != null ? avgOutcome : null;

    let score: number | null = null;
    if (effPart != null && stablePart != null) score = +(effPart * 0.3 + qualityPart * 0.45 + stablePart * 0.25).toFixed(1);
    else if (stablePart != null) score = +(qualityPart * 0.6 + stablePart * 0.4).toFixed(1);
    else if (effPart != null) score = +((effPart * 0.4 + qualityPart * 0.6)).toFixed(1);

    const sampleNote = nSessions < 3
      ? `样本仅 ${nSessions} 会话, 结论参考性有限`
      : turns < 10
        ? `turn 样本 ${turns} 偏少`
        : "样本充足";

    models.push({
      model,
      sessions: nSessions,
      turns,
      tools,
      tokensIn: r.tin,
      tokensOut: r.tout,
      tokensTotal,
      tokensPerTurn,
      errorRate: +errRate.toFixed(3),
      retryRate: +retRate.toFixed(3),
      emptyTurnRate: +empRate.toFixed(3),
      writeActionRatio: writeRatio != null ? +writeRatio.toFixed(3) : null,
      avgOutcome,
      grades: r.grades,
      score,
      sampleNote,
    });
  }

  models.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.sessions - a.sessions);
  return { models, globalBaseline: baseline };
}

/** 两个模型对比(重点: 同项目下的对比才是公平比较) */
export function compareModels(modelA: string, modelB: string): {
  note: string;
  dims: { dim: string; a: number | string | null; b: number | string | null; better: "a" | "b" | "tie" | "na" }[];
} {
  const { models } = evaluateModels();
  const A = models.find((m) => m.model === modelA);
  const B = models.find((m) => m.model === modelB);
  if (!A || !B) return { note: "至少一个模型无数据", dims: [] };

  const cmpNum = (a: number | null, b: number | null, lowerBetter: boolean): "a" | "b" | "tie" | "na" => {
    if (a == null || b == null) return "na";
    if (a === b) return "tie";
    return lowerBetter ? (a < b ? "a" : "b") : a > b ? "a" : "b";
  };

  const dims: ConfigDiffDims[] = [
    { dim: "综合评分", a: A.score, b: B.score, better: cmpNum(A.score, B.score, false) },
    { dim: "会话数", a: A.sessions, b: B.sessions, better: "na" },
    { dim: "turns", a: A.turns, b: B.turns, better: "na" },
    { dim: "tokens/turn (效率)", a: A.tokensPerTurn, b: B.tokensPerTurn, better: cmpNum(A.tokensPerTurn, B.tokensPerTurn, true) },
    { dim: "错误率 (低好)", a: A.errorRate, b: B.errorRate, better: cmpNum(A.errorRate, B.errorRate, true) },
    { dim: "重试率 (低好)", a: A.retryRate, b: B.retryRate, better: cmpNum(A.retryRate, B.retryRate, true) },
    { dim: "空转率 (低好)", a: A.emptyTurnRate, b: B.emptyTurnRate, better: cmpNum(A.emptyTurnRate, B.emptyTurnRate, true) },
    { dim: "写动作占比 (高好)", a: A.writeActionRatio, b: B.writeActionRatio, better: cmpNum(A.writeActionRatio, B.writeActionRatio, false) },
    { dim: "成效分均值 (高好)", a: A.avgOutcome, b: B.avgOutcome, better: cmpNum(A.avgOutcome, B.avgOutcome, false) },
  ];
  const sameProject = A.sessions > 0 && B.sessions > 0;
  return {
    note: sameProject
      ? "提示: 公平对比需同项目同任务; 建议同一 cwd 下分别跑同类任务后查看"
      : "提示: 数据不足",
    dims,
  };
}

type ConfigDiffDims = { dim: string; a: number | string | null; b: number | string | null; better: "a" | "b" | "tie" | "na" };
