/**
 * 异常自动发现 (阶段5: 默认视图展示异常, 不是平铺指标)
 *
 * 规则引擎: 基于统一库(SQLite)与技能注册表, 输出人类可读的异常清单。
 * 设计原则: 只报"和平时不一样的地方", 每条附带建议动作(actionHint)。
 */
import { getDb } from "../db/store.js";
import { semanticDedupe } from "../core/skills/semanticDedupe.js";

export interface Anomaly {
  level: "critical" | "warning" | "info";
  type: string;
  title: string;
  detail: string;
  actionHint?: string;
  sessionId?: string;
}

export function detectAnomalies(): Anomaly[] {
  const out: Anomaly[] = [];
  const d = getDb();

  // ---------- R1 会话级错误率/重试/空转 ----------
  interface Row {
    session_id: string;
    turns: number;
    tools: number;
    errors: number;
    started_at?: string;
    retries?: number;
    empty_turns?: number;
  }
  const rows = d
    .prepare(`
      SELECT s.id AS session_id, s.started_at,
        (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) AS turns,
        (SELECT COUNT(*) FROM tool_calls tc WHERE tc.session_id = s.id) AS tools,
        (SELECT COALESCE(SUM(tc.is_error),0) FROM tool_calls tc WHERE tc.session_id = s.id) AS errors
      FROM sessions s
    `)
    .all() as Row[];

  // 重试独立统计(better-sqlite3 无窗口函数依赖限制, 逐行查)
  const retryStmt = d.prepare(`
    SELECT COUNT(*) AS n FROM tool_calls a
    WHERE a.session_id = ? AND EXISTS (
      SELECT 1 FROM tool_calls b WHERE b.session_id = a.session_id
        AND b.name = a.name AND b.input IS a.input AND b.rowid = a.rowid - 1)
  `);
  const emptyTurnStmt = d.prepare(`
    SELECT COUNT(*) AS n FROM turns t WHERE t.session_id = ?
      AND NOT EXISTS (SELECT 1 FROM thinkings th WHERE th.turn_id = t.id)
      AND NOT EXISTS (SELECT 1 FROM tool_calls tc WHERE tc.turn_id = t.id)
  `);

  let globalErrSum = 0;
  let globalTools = 0;
  for (const r of rows) {
    globalErrSum += r.errors;
    globalTools += r.tools;
  }
  const baseErrRate = globalTools ? globalErrSum / globalTools : 0;

  for (const r of rows) {
    const shortId = r.session_id.slice(0, 34);
    const errRate = r.tools ? r.errors / r.tools : 0;
    if (r.errors > 0 && errRate >= 0.05 && (baseErrRate === 0 || errRate > baseErrRate * 3)) {
      out.push({
        level: errRate > 0.25 ? "critical" : "warning",
        type: "error-spike",
        title: `错误率异常: ${(errRate * 100).toFixed(0)}% (${r.errors}/${r.tools})`,
        detail: `会话 ${shortId} 的工具错误率显著高于全局基线 ${(baseErrRate * 100).toFixed(1)}%`,
        actionHint: "打开审查回放定位出错的具体 turn",
        sessionId: r.session_id,
      });
    }
    if (r.tools >= 10) {
      const retries = (retryStmt.get(r.session_id) as { n: number }).n;
      const rr = retries / r.tools;
      if (rr > 0.15) {
        out.push({
          level: "warning",
          type: "retry-storm",
          title: `重试风暴: ${retries} 次 (${(rr * 100).toFixed(0)}%)`,
          detail: `会话 ${shortId} 存在大量相邻同名同参调用，可能卡在循环`,
          actionHint: "检查该 turn 是否陷入无效循环",
          sessionId: r.session_id,
        });
      }
    }
    if (r.turns >= 3) {
      const empties = (emptyTurnStmt.get(r.session_id) as { n: number }).n;
      const er = empties / r.turns;
      if (er > 0.6 && er > 0) {
        out.push({
          level: "info",
          type: "idle-turns",
          title: `空转偏高: ${empties}/${r.turns} 回合无产出`,
          detail: `会话 ${shortId} 多数回合没有工具调用也没有回复文本`,
          actionHint: "可能是被中断或纯等待型会话",
          sessionId: r.session_id,
        });
      }
    }
  }

  // ---------- R2 token 异常(单会话超均值4倍) ----------
  const costRows = d
    .prepare(`SELECT session_id, SUM(input_tokens+output_tokens) AS total FROM costs GROUP BY session_id HAVING total > 0`)
    .all() as { session_id: string; total: number }[];
  if (costRows.length >= 3) {
    const avg = costRows.reduce((a, b) => a + b.total, 0) / costRows.length;
    for (const c of costRows) {
      if (c.total > avg * 4) {
        out.push({
          level: "info",
          type: "token-outlier",
          title: `Token 用量离群: ${Math.round(c.total).toLocaleString()} (均值 ${Math.round(avg).toLocaleString()})`,
          detail: `会话 ${c.session_id.slice(0, 34)} 消耗是平均值的 ${(c.total / avg).toFixed(1)} 倍`,
          actionHint: "评估上下文是否冗长、任务是否应拆分",
          sessionId: c.session_id,
        });
      }
    }
  }

  // ---------- R3 技能高置信语义重复 ----------
  try {
    const dupes = semanticDedupe().filter((x) => x.verdict === "semantic-duplicate");
    for (const p of dupes.slice(0, 5)) {
      out.push({
        level: "warning",
        type: "skill-duplicate",
        title: `技能疑似重复(${p.score}): [${p.a}] ↔ [${p.b}]`,
        detail: p.signals.join(", "),
        actionHint: "人工拍板：合并或明确分工（hm dedupe 查看）",
      });
    }
  } catch { /* 说明库不可用时跳过 */ }

  // ---------- R4 解析降级会话 ----------
  const degradedRows = d.prepare("SELECT id FROM sessions WHERE degraded=1").all() as { id: string }[];
  for (const dg of degradedRows.slice(0, 5)) {
    out.push({
      level: "info",
      type: "degraded-session",
      title: `解析降级的会话存在: ${dg.id.slice(0, 30)}`,
      detail: "部分行损坏未导入，回放可能不完整",
      actionHint: "忽略即可；如需完整数据检查原始日志文件",
      sessionId: dg.id,
    });
  }

  // 排序: critical > warning > info
  const order = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
