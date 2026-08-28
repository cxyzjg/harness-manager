/**
 * SQLite 存储层 (docs/SCHEMA.md D1)
 * 原始 JSONL 是事实源; 这里是查询/聚合层。全库位于 ~/.harness-manager/db.sqlite
 */
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { dataDir } from "../config.js";
import type {
  UnifiedSession,
  Turn,
  ThinkingBlock,
  ToolCallRecord,
  CostRecord,
  IngestResult,
} from "../core/schema.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  mkdirSync(dataDir(), { recursive: true });
  db = new Database(join(dataDir(), "db.sqlite"));
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      harness TEXT NOT NULL,
      cwd TEXT,
      started_at TEXT,
      ended_at TEXT,
      model TEXT,
      degraded INTEGER NOT NULL DEFAULT 0,
      source_file TEXT,
      ingested_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      ts TEXT,
      user_input TEXT,
      context_before TEXT,           -- json {messages,thinking,tools}
      UNIQUE(session_id, idx)
    );
    CREATE TABLE IF NOT EXISTS thinkings (
      session_id TEXT NOT NULL,
      turn_id TEXT,
      idx INTEGER NOT NULL,
      content TEXT,
      ts TEXT,
      UNIQUE(session_id, turn_id, idx)
    );
    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT,
      session_id TEXT NOT NULL,
      turn_id TEXT,
      name TEXT NOT NULL,
      input TEXT,
      output TEXT,
      started_at TEXT,
      ended_at TEXT,
      duration_ms INTEGER,
      is_error INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, id)
    );
    CREATE TABLE IF NOT EXISTS costs (
      session_id TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      recorded_at TEXT
    );
    CREATE TABLE IF NOT EXISTS ingest_errors (
      file TEXT,
      line INTEGER,
      reason TEXT,
      at TEXT NOT NULL
    );
    -- 查询索引
    CREATE INDEX IF NOT EXISTS idx_sessions_harness ON sessions(harness);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, idx);
    CREATE INDEX IF NOT EXISTS idx_tools_session ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_tools_name ON tool_calls(name);
  `);

  // ---- v2.1 增量迁移(可重复执行: CREATE IF NOT EXISTS + ALTER用try-catch容剾重复列) ----
  d.exec(`
    CREATE TABLE IF NOT EXISTS agent_configs (
      id TEXT PRIMARY KEY,
      harness TEXT NOT NULL,
      version_hash TEXT NOT NULL,
      system_prompt TEXT,
      model TEXT,
      thinking_level TEXT,
      allowed_tools TEXT,
      skills_loaded TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS context_snapshots (
      turn_id TEXT PRIMARY KEY,
      system_prompt_tokens INTEGER,
      history_tokens INTEGER,
      tool_result_tokens INTEGER,
      file_content_tokens INTEGER,
      memory_entries_used TEXT,
      snapshot_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ctxsnap_turn ON context_snapshots(turn_id);
  `);
  for (const stmt of [
    "ALTER TABLE sessions ADD COLUMN agent_config_ref TEXT",
    "ALTER TABLE turns ADD COLUMN config_ref TEXT",
  ]) {
    try {
      d.exec(stmt);
    } catch {
      /* 列已存在 */
    }
  }
}

/** 导入一个适配器结果: 先删旧(按session)再插, 幂等 */
export function ingest(res: IngestResult): { ok: boolean; sessionId?: string; errorCount: number } {
  if (!res.session) {
    recordErrors(res.errors);
    return { ok: false, errorCount: res.errors.length };
  }
  const vErrors = validate(res);
  if (vErrors.length) {
    // 校验失败也降级为 errors 记录, 不阻断(D2)
    recordErrors(vErrors.map((r) => ({ file: res.session!.source_file ?? "", reason: r })));
  }
  const d = getDb();
  const now = new Date().toISOString();
  const sess = res.session;
  const tx = d.transaction(() => {
    const sid = sess!.id;
    d.prepare("DELETE FROM turns WHERE session_id=?").run(sid);
    d.prepare("DELETE FROM thinkings WHERE session_id=?").run(sid);
    d.prepare("DELETE FROM tool_calls WHERE session_id=?").run(sid);
    d.prepare("DELETE FROM costs WHERE session_id=?").run(sid);

    d.prepare(`INSERT OR REPLACE INTO sessions (id,harness,cwd,started_at,ended_at,model,degraded,source_file,ingested_at)
               VALUES (@id,@harness,@cwd,@started_at,@ended_at,@model,@degraded,@source_file,@now)`)
      .run({
        id: sid,
        harness: sess!.harness,
        cwd: sess!.cwd ?? null,
        started_at: sess!.started_at ?? null,
        ended_at: sess!.ended_at ?? null,
        model: sess!.model ?? null,
        degraded: sess!.degraded ? 1 : 0,
        source_file: sess!.source_file ?? null,
        now,
      });

    const insTurn = d.prepare(`INSERT OR REPLACE INTO turns (id,session_id,idx,ts,user_input,context_before)
                               VALUES (@id,@session_id,@idx,@ts,@user_input,@context_before)`);
    for (const t of res.turns) insTurn.run({
      id: t.id, session_id: t.session_id, idx: t.idx,
      ts: t.ts ?? null, user_input: t.user_input ?? "",
      context_before: JSON.stringify(t.context_before ?? {}),
    });

    const insThink = d.prepare(`INSERT OR REPLACE INTO thinkings (session_id,turn_id,idx,content,ts)
                                VALUES (@session_id,@turn_id,@idx,@content,@ts)`);
    for (const th of res.thinkings) insThink.run({
      session_id: th.session_id, turn_id: th.turn_id ?? null, idx: th.idx,
      content: th.content ?? "", ts: th.ts ?? null,
    });

    const insTool = d.prepare(`INSERT OR REPLACE INTO tool_calls (id,session_id,turn_id,name,input,output,started_at,ended_at,duration_ms,is_error)
                               VALUES (@id,@session_id,@turn_id,@name,@input,@output,@started_at,@ended_at,@duration_ms,@is_error)`);
    for (const tc of res.tool_calls) {
      insTool.run({
        id: tc.id, session_id: tc.session_id, turn_id: tc.turn_id ?? null,
        name: tc.name, input: stringify(tc.input), output: stringify(tc.output),
        started_at: tc.started_at ?? null, ended_at: tc.ended_at ?? null,
        duration_ms: tc.duration_ms ?? null, is_error: tc.is_error ? 1 : 0,
      });
    }

    const insCost = d.prepare(`INSERT INTO costs (session_id,model,input_tokens,output_tokens,recorded_at)
                               VALUES (@session_id,@model,@input_tokens,@output_tokens,@recorded_at)`);
    for (const c of res.costs) insCost.run({
      session_id: c.session_id, model: c.model ?? null,
      input_tokens: c.input_tokens ?? 0, output_tokens: c.output_tokens ?? 0,
      recorded_at: c.recorded_at ?? null,
    });

    recordErrors(res.errors);
  });
  tx();
  return { ok: true, sessionId: res.session.id, errorCount: res.errors.length };
}

function validate(res: IngestResult): string[] {
  // 轻量校验(SCHEMA.md 兼容性承诺): 关键字段存在性
  const errs: string[] = [];
  for (const t of res.turns) {
    if (typeof t.user_input !== "string") errs.push(`turn ${t.idx} user_input 类型异常`);
  }
  return errs;
}

function recordErrors(errors: { file: string; line?: number; reason: string }[]): void {
  if (!errors?.length) return;
  const ins = getDb().prepare("INSERT INTO ingest_errors (file,line,reason,at) VALUES (@file,@line,@reason,@at)");
  const at = new Date().toISOString();
  for (const e of errors) ins.run({ ...e, at });
}

function stringify(v: unknown): string | null {
  if (v == null) return null;
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ---------- 查询 API ----------
export type SessionSort = "active" | "started" | "tokens";

/** 列表排序: active=最后活跃(默认) / started=开始时间 / tokens=消耗最多 */
export function listSessions(harness?: string, sort: SessionSort = "active"): UnifiedSession[] {
  const order =
    sort === "started"
      ? "COALESCE(started_at, ended_at) DESC"
      : sort === "tokens"
        ? "COALESCE((SELECT SUM(input_tokens+output_tokens) FROM costs c WHERE c.session_id = sessions.id), 0) DESC"
        : "COALESCE(ended_at, started_at) DESC";
  const rows = harness
    ? getDb().prepare(`SELECT * FROM sessions WHERE harness=? ORDER BY ${order}`).all(harness)
    : getDb().prepare(`SELECT * FROM sessions ORDER BY ${order}`).all();
  return (rows as Record<string, unknown>[]).map(rowToSession);
}

function rowToSession(r: Record<string, unknown>): UnifiedSession {
  return {
    id: r.id as string,
    harness: r.harness as UnifiedSession["harness"],
    cwd: (r.cwd as string) ?? undefined,
    started_at: (r.started_at as string) ?? undefined,
    ended_at: (r.ended_at as string) ?? undefined,
    model: (r.model as string) ?? undefined,
    degraded: !!r.degraded,
    source_file: (r.source_file as string) ?? undefined,
  };
}

export function getSession(id: string): UnifiedSession | null {
  // 支持前缀查询(用户常传短id)
  const exact = getDb().prepare("SELECT * FROM sessions WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (exact) return rowToSession(exact);
  const like = getDb().prepare("SELECT * FROM sessions WHERE id LIKE ? LIMIT 1").all(id + "%") as Record<string, unknown>[];
  return like[0] ? rowToSession(like[0]) : null;
}

export function getTurns(sessionId: string): Turn[] {
  const rows = getDb().prepare("SELECT * FROM turns WHERE session_id=? ORDER BY idx").all(sessionId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    session_id: r.session_id as string,
    idx: r.idx as number,
    ts: (r.ts as string) ?? undefined,
    user_input: (r.user_input as string) ?? "",
    context_before: safeJson(r.context_before as string) as { messages: number; thinking: number; tools: number },
  }));
}

export function getToolCalls(sessionId: string): ToolCallRecord[] {
  const rows = getDb().prepare("SELECT * FROM tool_calls WHERE session_id=? ORDER BY started_at").all(sessionId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    session_id: r.session_id as string,
    turn_id: (r.turn_id as string) ?? undefined,
    name: r.name as string,
    input: safeJson(r.input as string),
    output: safeJson(r.output as string),
    started_at: (r.started_at as string) ?? undefined,
    ended_at: (r.ended_at as string) ?? undefined,
    duration_ms: (r.duration_ms as number) ?? undefined,
    is_error: !!r.is_error,
  }));
}

export function getThinkings(sessionId: string): ThinkingBlock[] {
  const rows = getDb().prepare("SELECT * FROM thinkings WHERE session_id=? ORDER BY idx").all(sessionId) as Record<string, unknown>[];
  return rows.map((r) => ({
    session_id: r.session_id as string,
    turn_id: (r.turn_id as string) ?? undefined,
    idx: r.idx as number,
    content: (r.content as string) ?? "",
    ts: (r.ts as string) ?? undefined,
  }));
}

export function getCostsByModel(): { model: string; input: number; output: number; sessions: number }[] {
  return getDb().prepare(`
    SELECT COALESCE(model,'unknown') AS model,
           SUM(input_tokens) AS input, SUM(output_tokens) AS output,
           COUNT(DISTINCT session_id) AS sessions
    FROM costs GROUP BY model ORDER BY input DESC`).all() as never[];
}

/** 全库统计(仪表盘用) */
/** 每会话统计(turn数/工具数/思考数/token, 列表页一次查询) */
export function perSessionStats(): Record<string, { turns: number; tools: number; thinking: number; tokensIn: number; tokensOut: number }> {
  const d = getDb();
  const out: Record<string, { turns: number; tools: number; thinking: number; tokensIn: number; tokensOut: number }> = {};
  for (const r of d.prepare("SELECT session_id, COUNT(*) AS n FROM turns GROUP BY session_id").all() as { session_id: string; n: number }[]) {
    out[r.session_id] = out[r.session_id] ?? { turns: 0, tools: 0, thinking: 0, tokensIn: 0, tokensOut: 0 };
    out[r.session_id].turns = r.n;
  }
  for (const r of d.prepare("SELECT session_id, COUNT(*) AS n FROM tool_calls GROUP BY session_id").all() as { session_id: string; n: number }[]) {
    const o = (out[r.session_id] ??= { turns: 0, tools: 0, thinking: 0, tokensIn: 0, tokensOut: 0 });
    o.tools = r.n;
  }
  for (const r of d.prepare("SELECT session_id, COUNT(*) AS n FROM thinkings GROUP BY session_id").all() as { session_id: string; n: number }[]) {
    const o = (out[r.session_id] ??= { turns: 0, tools: 0, thinking: 0, tokensIn: 0, tokensOut: 0 });
    o.thinking = r.n;
  }
  for (const r of d.prepare("SELECT session_id, SUM(input_tokens) AS i, SUM(output_tokens) AS o FROM costs GROUP BY session_id").all() as { session_id: string; i: number | null; o: number | null }[]) {
    const o = (out[r.session_id] ??= { turns: 0, tools: 0, thinking: 0, tokensIn: 0, tokensOut: 0 });
    o.tokensIn = r.i ?? 0;
    o.tokensOut = r.o ?? 0;
  }
  return out;
}

// ---------- v2.1: agent配置快照与上下文构成 ----------
import { createHash } from "node:crypto";
import type { AgentConfig, ContextSnapshot } from "../core/schema.js";

/** 内容hash -> 稳定config id (同内容=同版本) */
export function agentConfigId(harness: string, content: string): { id: string; hash: string } {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  return { id: `cfg_${harness}_${hash}`, hash };
}

/** 保存/更新配置快照(幂等, 同id覆盖) */
export function saveAgentConfig(cfg: AgentConfig): void {
  getDb()
    .prepare(`INSERT OR REPLACE INTO agent_configs (id,harness,version_hash,system_prompt,model,thinking_level,allowed_tools,skills_loaded,created_at)
              VALUES (@id,@harness,@version_hash,@system_prompt,@model,@thinking_level,@allowed_tools,@skills_loaded,@created_at)`)
    .run({
      id: cfg.id,
      harness: cfg.harness,
      version_hash: cfg.version_hash,
      system_prompt: cfg.system_prompt ?? null,
      model: cfg.model ?? null,
      thinking_level: cfg.thinking_level ?? null,
      allowed_tools: cfg.allowed_tools ? JSON.stringify(cfg.allowed_tools) : null,
      skills_loaded: cfg.skills_loaded ? JSON.stringify(cfg.skills_loaded) : null,
      created_at: cfg.created_at ?? new Date().toISOString(),
    });
}

export function getAgentConfig(id: string): AgentConfig | null {
  const r = getDb().prepare("SELECT * FROM agent_configs WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: r.id as string,
    harness: r.harness as AgentConfig["harness"],
    version_hash: r.version_hash as string,
    system_prompt: (r.system_prompt as string) ?? "",
    model: (r.model as string) ?? undefined,
    thinking_level: (r.thinking_level as string) ?? undefined,
    allowed_tools: safeJson(r.allowed_tools as string) as string[] | undefined,
    skills_loaded: safeJson(r.skills_loaded as string) as string[] | undefined,
    created_at: (r.created_at as string) ?? undefined,
  };
}

/** 会话绑定配置 */
export function linkSessionConfig(sessionId: string, configId: string): void {
  getDb().prepare("UPDATE sessions SET agent_config_ref=? WHERE id=?").run(configId, sessionId);
}

/** turn绑定配置 */
export function linkTurnConfig(turnId: string, configId: string): void {
  getDb().prepare("UPDATE turns SET config_ref=? WHERE id=?").run(configId, turnId);
}

/** 保存turn上下文快照(幂等) */
export function saveContextSnapshot(s: ContextSnapshot): void {
  getDb()
    .prepare(`INSERT OR REPLACE INTO context_snapshots (turn_id,system_prompt_tokens,history_tokens,tool_result_tokens,file_content_tokens,memory_entries_used,snapshot_at)
              VALUES (@turn_id,@system_prompt_tokens,@history_tokens,@tool_result_tokens,@file_content_tokens,@memory_entries_used,@snapshot_at)`)
    .run({
      turn_id: s.turn_id,
      system_prompt_tokens: s.system_prompt_tokens ?? null,
      history_tokens: s.history_tokens ?? null,
      tool_result_tokens: s.tool_result_tokens ?? null,
      file_content_tokens: s.file_content_tokens ?? null,
      memory_entries_used: s.memory_entries_used ? JSON.stringify(s.memory_entries_used) : null,
      snapshot_at: s.snapshot_at ?? new Date().toISOString(),
    });
}

/** 列出全部配置版本 + 关联会话数 */
export function listConfigs(): (AgentConfig & { sessionCount: number })[] {
  const rows = getDb()
    .prepare(`SELECT ac.*, (SELECT COUNT(*) FROM sessions s WHERE s.agent_config_ref = ac.id) AS sessionCount
              FROM agent_configs ac ORDER BY ac.created_at DESC`)
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    harness: r.harness as AgentConfig["harness"],
    version_hash: r.version_hash as string,
    system_prompt: (r.system_prompt as string) ?? "",
    model: (r.model as string) ?? undefined,
    thinking_level: (r.thinking_level as string) ?? undefined,
    allowed_tools: safeJson(r.allowed_tools as string) as string[] | undefined,
    skills_loaded: safeJson(r.skills_loaded as string) as string[] | undefined,
    created_at: (r.created_at as string) ?? undefined,
    sessionCount: (r.sessionCount as number) ?? 0,
  }));
}

/** 某配置关联的全部会话(用于成效对比) */
export function sessionsOfConfig(configId: string): string[] {
  return (getDb().prepare("SELECT id FROM sessions WHERE agent_config_ref=?").all(configId) as { id: string }[]).map(
    (r) => r.id
  );
}

export function getContextSnapshots(sessionId: string): (ContextSnapshot & { turn_idx?: number })[] {
  const rows = getDb()
    .prepare(`SELECT cs.* FROM context_snapshots cs
              JOIN turns t ON t.id = cs.turn_id WHERE t.session_id=? ORDER BY t.idx`)
    .all(sessionId) as Record<string, unknown>[];
  return rows.map((r) => ({
    turn_id: r.turn_id as string,
    system_prompt_tokens: (r.system_prompt_tokens as number) ?? undefined,
    history_tokens: (r.history_tokens as number) ?? undefined,
    tool_result_tokens: (r.tool_result_tokens as number) ?? undefined,
    file_content_tokens: (r.file_content_tokens as number) ?? undefined,
    memory_entries_used: safeJson(r.memory_entries_used as string) as string[] | undefined,
    snapshot_at: (r.snapshot_at as string) ?? undefined,
  }));
}

export function globalStats(): { sessions: number; turns: number; tools: number; errors: number; byHarness: Record<string, number> } {
  const d = getDb();
  const one = (sql: string): number => (d.prepare(sql).get() as { n: number }).n;
  const byHarness: Record<string, number> = {};
  for (const r of d.prepare("SELECT harness, COUNT(*) AS n FROM sessions GROUP BY harness").all() as { harness: string; n: number }[]) {
    byHarness[r.harness] = r.n;
  }
  return {
    sessions: one("SELECT COUNT(*) AS n FROM sessions"),
    turns: one("SELECT COUNT(*) AS n FROM turns"),
    tools: one("SELECT COUNT(*) AS n FROM tool_calls"),
    errors: one("SELECT COUNT(*) AS n FROM ingest_errors"),
    byHarness,
  };
}

function safeJson(s: string | null): unknown {
  if (s == null) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
