/**
 * 阶段2: 基于统一Schema(SQLite)的回放器查询层
 * 验收标准: 完整回放 "用户问什么 -> 思考 -> 工具调用 -> 回复 -> 当时上下文" 无缺失
 *
 * 与旧 turnView(每次重解析JSONL)不同, 这里全部走SQL索引, 大库不再卡顿。
 */
import { getDb, getTurns, getToolCalls, getThinkings, getSession } from "./store.js";
import type { Turn, ThinkingBlock, ToolCallRecord, UnifiedSession } from "../core/schema.js";

/** 前缀 -> 完整session_id */
export function resolveSessionId(prefix: string): string | null {
  const row = getDb().prepare("SELECT id FROM sessions WHERE id=? OR id LIKE ? LIMIT 1").all(prefix, prefix + "%") as { id: string }[];
  return row[0]?.id ?? null;
}

export interface ReviewTurn {
  index: number;
  ts?: string;
  userInput: string;
  thinking: { text: string; ts?: string }[];
  tools: { name: string; input?: unknown; output?: unknown; durationMs?: number; error?: boolean; ts?: string }[];
  contextBefore: { messages: number; thinking: number; tools: number };
}

export interface SessionReview {
  session: UnifiedSession;
  totals: { turns: number; tools: number; thinkingBlocks: number; tokensIn: number; tokensOut: number };
  turns: ReviewTurn[];
}

/** 组装一个会话的完整审查视图 */
export function buildReviewFromDb(sessionId: string): SessionReview | null {
  const fullId = resolveSessionId(sessionId);
  if (!fullId) return null;
  const session = getSession(fullId);
  if (!session) return null;

  const turns: Turn[] = getTurns(fullId);
  const tools: ToolCallRecord[] = getToolCalls(fullId);
  const thinks: ThinkingBlock[] = getThinkings(fullId);

  // 按 turn 分组(thinking/tool 通过 turn_id 关联)
  const byTurn = new Map<string, { thinking: ThinkingBlock[]; tools: ToolCallRecord[] }>();
  for (const t of turns) byTurn.set(t.id, { thinking: [], tools: [] });
  for (const th of thinks) {
    if (th.turn_id && byTurn.has(th.turn_id)) byTurn.get(th.turn_id)!.thinking.push(th);
    else {
      // 无归属(容错): 挂到第一个 turn
      const first = turns[0];
      if (first) byTurn.get(first.id)?.thinking.push(th);
    }
  }
  for (const tc of tools) {
    if (tc.turn_id && byTurn.has(tc.turn_id)) byTurn.get(tc.turn_id)!.tools.push(tc);
    else {
      const first = turns[0];
      if (first) byTurn.get(first.id)?.tools.push(tc);
    }
  }

  // token 汇总
  const costRow = getDb()
    .prepare("SELECT SUM(input_tokens) AS i, SUM(output_tokens) AS o FROM costs WHERE session_id=?")
    .get(sessionId) as { i: number | null; o: number | null };

  const reviewTurns: ReviewTurn[] = turns.map((t) => {
    const bucket = byTurn.get(t.id)!;
    return {
      index: t.idx,
      ts: t.ts,
      userInput: t.user_input,
      thinking: bucket.thinking.map((x) => ({ text: x.content, ts: x.ts })),
      tools: bucket.tools.map((tc) => ({
        name: tc.name,
        input: tc.input,
        output: tc.output,
        durationMs: tc.duration_ms,
        error: tc.is_error,
        ts: tc.started_at,
      })),
      contextBefore: t.context_before ?? { messages: 0, thinking: 0, tools: 0 },
    };
  });

  return {
    session,
    totals: {
      turns: turns.length,
      tools: tools.length,
      thinkingBlocks: thinks.length,
      tokensIn: costRow?.i ?? 0,
      tokensOut: costRow?.o ?? 0,
    },
    turns: reviewTurns,
  };
}

/** 跨会话指标聚合(SQL 直接算, 替代旧 metrics 的 JS 遍历) */
export function fleetMetrics(): {
  sessions: number;
  turns: number;
  toolCalls: number;
  errorRate: number;
  retryRate: number;
  emptyTurnRate: number;
  avgToolsPerTurn: number;
  tokenIn: number;
  tokenOut: number;
  globalGrade: string;
} {
  const d = getDb();
  const one = (sql: string): Record<string, unknown> => d.prepare(sql).get() as never;
  const totals = one(`
    SELECT
      (SELECT COUNT(*) FROM sessions) AS sessions,
      (SELECT COUNT(*) FROM turns) AS turns,
      (SELECT COUNT(*) FROM tool_calls) AS tools,
      (SELECT COALESCE(SUM(is_error),0) FROM tool_calls) AS errors,
      (SELECT COALESCE(SUM(input_tokens),0) FROM costs) AS tin,
      (SELECT COALESCE(SUM(output_tokens),0) FROM costs) AS tout
  `) as { sessions: number; turns: number; tools: number; errors: number; tin: number; tout: number };

  // 重试率: 同 session 相邻同名工具
  const retries = (d.prepare(`
    SELECT COUNT(*) AS n FROM tool_calls a
    WHERE EXISTS (
      SELECT 1 FROM tool_calls b
      WHERE b.session_id = a.session_id
        AND b.name = a.name
        AND b.input = a.input
        AND b.rowid = a.rowid - 1
    )`).get() as { n: number }).n;

  // 空转 turn: 无thinking且无tool
  const empty = (d.prepare(`
    SELECT COUNT(*) AS n FROM turns t
    WHERE NOT EXISTS (SELECT 1 FROM thinkings th WHERE th.turn_id = t.id)
      AND NOT EXISTS (SELECT 1 FROM tool_calls tc WHERE tc.turn_id = t.id)
  `).get() as { n: number }).n;

  const errRate = totals.tools ? totals.errors / totals.tools : 0;
  const retryRate = totals.tools ? retries / totals.tools : 0;
  const emptyRate = totals.turns ? empty / totals.turns : 0;
  const score = 100 - errRate * 400 - retryRate * 200 - emptyRate * 100;
  const grade = score >= 85 ? "A" : score >= 65 ? "B" : score >= 40 ? "C" : "D";

  return {
    sessions: totals.sessions,
    turns: totals.turns,
    toolCalls: totals.tools,
    errorRate: +errRate.toFixed(3),
    retryRate: +retryRate.toFixed(3),
    emptyTurnRate: +emptyRate.toFixed(3),
    avgToolsPerTurn: totals.turns ? +(totals.tools / totals.turns).toFixed(1) : 0,
    tokenIn: totals.tin,
    tokenOut: totals.tout,
    globalGrade: grade,
  };
}
