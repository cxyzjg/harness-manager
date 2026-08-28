/**
 * 阶段2: 基于统一Schema(SQLite)的回放器查询层
 * 验收标准: 完整回放 "用户问什么 -> 思考 -> 工具调用 -> 回复 -> 当时上下文" 无缺失
 *
 * 与旧 turnView(每次重解析JSONL)不同, 这里全部走SQL索引, 大库不再卡顿。
 */
import { getDb, getTurns, getToolCalls, getThinkings, getSession, listSessions, getContextSnapshots, getAgentConfig } from "./store.js";
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
  agentConfig?: import("../core/schema.js").AgentConfig | null;  // v2.1 会话配置快照
  contextSnapshots?: (import("../core/schema.js").ContextSnapshot & { turn_idx?: number })[]; // v2.1
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

  // v2.1: 配置快照 + 上下文构成
  const ctxSnaps = getContextSnapshots(session.id);
  const agentConfig = (session as UnifiedSession & { agent_config_ref?: string }).agent_config_ref
    ? getAgentConfig((session as UnifiedSession & { agent_config_ref?: string }).agent_config_ref!)
    : null;

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
    agentConfig,
    contextSnapshots: ctxSnaps,
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

/** 指标下钻: 错误调用明细(哪个会话/turn/工具/错误内容) */
export function errorDrilldown(limit = 50): {
  session_id: string;
  turn_idx: number;
  name: string;
  input?: unknown;
  output?: unknown;
  started_at?: string;
}[] {
  const rows = getDb()
    .prepare(`
      SELECT tc.session_id, t.idx AS turn_idx, tc.name, tc.input, tc.output, tc.started_at
      FROM tool_calls tc LEFT JOIN turns t ON t.id = tc.turn_id
      WHERE tc.is_error = 1
      ORDER BY tc.started_at DESC LIMIT ?
    `)
    .all(limit) as { session_id: string; turn_idx: number | null; name: string; input: string | null; output: string | null; started_at: string | null }[];
  return rows.map((r) => ({
    session_id: r.session_id,
    turn_idx: r.turn_idx ?? -1,
    name: r.name,
    input: safeParse(r.input),
    output: safeParse(r.output),
    started_at: r.started_at ?? undefined,
  }));
}

/** 指标下钻: 重试对(相邻同名同参) */
export function retryDrilldown(limit = 30): { session_id: string; name: string; started_at?: string }[] {
  const rows = getDb()
    .prepare(`
      SELECT a.session_id, a.name, a.started_at FROM tool_calls a
      WHERE EXISTS (
        SELECT 1 FROM tool_calls b
        WHERE b.session_id = a.session_id AND b.name = a.name AND b.input IS a.input
          AND b.rowid = a.rowid - 1
      ) ORDER BY a.started_at DESC LIMIT ?
    `)
    .all(limit) as never[];
  return rows as never[];
}

/** 会话级指标明细(供逐会话等级列表+下钻) */
export function perSessionReliability(): {
  sessionId: string;
  harness: string;
  cwd?: string;
  turns: number;
  tools: number;
  errors: number;
  errorRate: number;
  retries: number;
  retryRate: number;
  emptyTurns: number;
  grade: string;
}[] {
  const d = getDb();
  const sessions = listSessions();
  const out: ReturnType<typeof perSessionReliability> = [];
  for (const s of sessions) {
    const one = (sql: string): Record<string, unknown> => d.prepare(sql).get(s.id) as never;
    const tools = (one("SELECT COUNT(*) AS n FROM tool_calls WHERE session_id=?") as { n: number }).n;
    const errors = (one("SELECT COUNT(*) AS n FROM tool_calls WHERE session_id=? AND is_error=1") as { n: number }).n;
    const turnsRow = one("SELECT COUNT(*) AS n FROM turns WHERE session_id=?") as { n: number };
    const retries = (d.prepare(`
      SELECT COUNT(*) AS n FROM tool_calls a
      WHERE a.session_id = ? AND EXISTS (
        SELECT 1 FROM tool_calls b WHERE b.session_id = a.session_id
          AND b.name = a.name AND b.input IS a.input AND b.rowid = a.rowid - 1
      )`).get(s.id) as { n: number }).n;
    const emptyTurns = (d.prepare(`
      SELECT COUNT(*) AS n FROM turns t WHERE t.session_id=?
        AND NOT EXISTS (SELECT 1 FROM thinkings th WHERE th.turn_id=t.id)
        AND NOT EXISTS (SELECT 1 FROM tool_calls tc WHERE tc.turn_id=t.id)`).get(s.id) as { n: number }).n;
    const errRate = tools ? errors / tools : 0;
    const retRate = tools ? retries / tools : 0;
    const empRate = turnsRow.n ? emptyTurns / turnsRow.n : 0;
    const score2 = 100 - errRate * 400 - retRate * 200 - empRate * 100;
    const grade = score2 >= 85 ? "A" : score2 >= 65 ? "B" : score2 >= 40 ? "C" : "D";
    out.push({
      sessionId: s.id,
      harness: s.harness,
      cwd: s.cwd,
      turns: turnsRow.n,
      tools,
      errors,
      errorRate: +errRate.toFixed(3),
      retries,
      retryRate: +retRate.toFixed(3),
      emptyTurns,
      grade,
    });
  }
  return out.sort((a, b) => b.errorRate - a.errorRate || b.tools - a.tools);
}

function safeParse(s: string | null): unknown {
  if (s == null) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
