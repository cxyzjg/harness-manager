/**
 * M2 分析层：会话检索 / token 趋势 / 时间线 / 上下文规模
 */
import type { Session, ToolCall } from "../types.js";

// ---------- 会话检索 ----------
export interface SessionFilter {
  harness?: string;
  project?: string; // cwd 包含
  model?: string;
  since?: string; // ISO 起
  until?: string; // ISO 止
  query?: string; // 消息内容/工具入参关键词
}

export function filterSessions(sessions: Session[], f: SessionFilter): Session[] {
  return sessions.filter((s) => {
    if (f.harness && s.harness !== f.harness) return false;
    if (f.project && !s.cwd.toLowerCase().includes(f.project.toLowerCase())) return false;
    if (f.model && !(s.model ?? "").toLowerCase().includes(f.model.toLowerCase())) return false;
    if (f.since && (s.startedAt ?? "") < f.since) return false;
    if (f.until && (s.startedAt ?? "") > f.until) return false;
    if (f.query) {
      const hay = s.tools.map((t) => JSON.stringify(t.input ?? "")).join(" ").toLowerCase();
      if (!hay.includes(f.query.toLowerCase())) return false;
    }
    return true;
  });
}

// ---------- token 聚合 ----------
export interface TokenAgg {
  totalInput: number;
  totalOutput: number;
  total: number;
  byProject: Record<string, { sessions: number; input: number; output: number }>;
  byModel: Record<string, { sessions: number; input: number; output: number }>;
}

export function aggregateTokens(sessions: Session[]): TokenAgg {
  const agg: TokenAgg = { totalInput: 0, totalOutput: 0, total: 0, byProject: {}, byModel: {} };
  for (const s of sessions) {
    if (!s.tokenUsage) continue;
    agg.totalInput += s.tokenUsage.input;
    agg.totalOutput += s.tokenUsage.output;
    agg.total += s.tokenUsage.total;
    const proj = projectKey(s.cwd);
    const p = (agg.byProject[proj] ??= { sessions: 0, input: 0, output: 0 });
    p.sessions++; p.input += s.tokenUsage.input; p.output += s.tokenUsage.output;
    const model = s.model ?? "unknown";
    const m = (agg.byModel[model] ??= { sessions: 0, input: 0, output: 0 });
    m.sessions++; m.input += s.tokenUsage.input; m.output += s.tokenUsage.output;
  }
  return agg;
}

// ---------- 时间线 ----------
export interface TimelineEntry {
  index: number;
  ts?: string;
  kind: "message" | "tool";
  role?: string;
  toolName?: string;
  summary: string;
}

/** 按时间排序的会话时间线（消息 + 工具调用混合） */
export function buildTimeline(s: Session): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  s.tools.forEach((t, i) => {
    entries.push({
      index: i,
      ts: t.startedAt,
      kind: "tool",
      toolName: t.name,
      summary: summarize(t.input),
    });
  });
  // 消息无独立时间戳时，用 tools 的顺序近似；有则穿插
  entries.sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""));
  return entries;
}

// ---------- 上下文规模 ----------
export interface ContextStats {
  totalSessions: number;
  totalMessages: number;
  avgMessagesPerSession: number;
  /** 消息数最多的 Top 会话（可能接近上下文上限） */
  largeSessions: { id: string; messages: number; cwd: string }[];
  /** 估算 token：按平均每消息 token 推断（粗） */
  estimatedTotalTokens: number;
}

export function contextStats(sessions: Session[]): ContextStats {
  const totalSessions = sessions.length;
  const totalMessages = sessions.reduce((a, s) => a + s.messages, 0);
  const sorted = [...sessions].sort((a, b) => b.messages - a.messages);
  const withToken = sessions.filter((s) => s.tokenUsage);
  const avgTokensPerMsg = withToken.length
    ? withToken.reduce((a, s) => a + (s.tokenUsage!.total / Math.max(1, s.messages)), 0) / withToken.length
    : 0;
  return {
    totalSessions,
    totalMessages,
    avgMessagesPerSession: totalSessions ? Math.round(totalMessages / totalSessions) : 0,
    largeSessions: sorted.slice(0, 5).map((s) => ({ id: s.id, messages: s.messages, cwd: s.cwd })),
    estimatedTotalTokens: Math.round(totalMessages * avgTokensPerMsg),
  };
}

// ---------- 工具统计 ----------
export interface ToolStats {
  byName: Record<string, number>;
  total: number;
  topTools: { name: string; count: number }[];
  /** CC 会话中按相邻事件时间差估算的慢调用 */
  slowestInCc: ToolCall[];
}

export function toolStats(sessions: Session[]): ToolStats {
  const byName: Record<string, number> = {};
  let total = 0;
  for (const s of sessions) {
    for (const t of s.tools) {
      byName[t.name] = (byName[t.name] ?? 0) + 1;
      total++;
    }
  }
  const topTools = Object.entries(byName)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // CC 慢调用：用 tool_use 与 tool_result 的 timestamp 差
  const slowestInCc: ToolCall[] = [];
  for (const s of sessions) {
    if (s.harness !== "claude") continue;
    for (const t of s.tools) {
      if (t.durationMs != null && t.durationMs > 1000) slowestInCc.push(t);
    }
  }
  slowestInCc.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));
  return { byName, total, topTools, slowestInCc: slowestInCc.slice(0, 10) };
}

// ---------- helpers ----------
function projectKey(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.slice(0, 3).join("/") || cwd;
}

function summarize(input: unknown): string {
  if (input == null) return "";
  const s = typeof input === "string" ? input : JSON.stringify(input);
  if (!s) return "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > 100 ? one.slice(0, 100) + "…" : one;
}
