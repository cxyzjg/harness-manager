/**
 * 会话快速总结 (阶段补充②: "这段时间 agent 到底干了什么")
 *
 * 规则式摘要, 不依赖LLM(守D4全本机隐私):
 *  1. 会话级摘要: 规模/改动的文件/工具画像/动作统计
 *  2. 时段聚合摘要: 按天/全部 -> 每天主要项目、会话数、工具量、活跃度
 */
import { getDb } from "./store.js";

export interface ActionProfile {
  write: number; // 写/编辑文件
  read: number; // 读/查文件
  exec: number; // 执行命令
  search: number; // 搜索/grep
  plan: number; // 规划/问询
}

const WRITE_TOOLS = new Set(["write", "edit", "apply_patch", "patch"]);
const READ_TOOLS = new Set(["read", "ls", "find", "cat", "view"]);
const SEARCH_TOOLS = new Set(["grep", "search", "ffgrep", "fffind"]);
const EXEC_TOOLS = new Set(["bash", "exec", "sh"]);
const PLAN_TOOLS = new Set(["plan_mode_question", "plan_mode_complete", "to-spec", "to-tickets"]);

export function classifyTool(name: string): keyof ActionProfile {
  if (WRITE_TOOLS.has(name)) return "write";
  if (READ_TOOLS.has(name)) return "read";
  if (SEARCH_TOOLS.has(name)) return "search";
  if (EXEC_TOOLS.has(name)) return "exec";
  if (PLAN_TOOLS.has(name)) return "plan";
  return "exec"; // 其他归执行类
}

/** 从 write/edit 工具入参提取被改动的文件路径 */
export function extractTouchedFiles(toolCalls: { name: string; input: unknown }[]): string[] {
  const files = new Set<string>();
  for (const tc of toolCalls) {
    if (!WRITE_TOOLS.has(tc.name)) continue;
    const raw = tc.input;
    let input: { path?: unknown; file_path?: unknown; filePath?: unknown; edits?: unknown } | undefined;
    if (typeof raw === "string") {
      // store.ts 把 input 存成 JSON 字符串, 先尝试解析
      try {
        input = JSON.parse(raw);
      } catch {
        input = undefined;
      }
    } else if (raw && typeof raw === "object") {
      input = raw as typeof input;
    }
    if (!input) continue;
    const p = (input.path ?? input.file_path ?? input.filePath) as unknown;
    if (typeof p === "string" && p.length < 300) files.add(p);
  }
  return [...files];
}

export interface SessionSummary {
  id: string;
  harness: string;
  started_at?: string;
  turns: number;
  tools: number;
  thinkings: number;
  tokensIn: number;
  tokensOut: number;
  touchedFiles: string[];
  topTools: { name: string; count: number }[];
  actions: ActionProfile;
  headline: string; // 一句话画像
}

export function summarizeSession(sessionId: string): SessionSummary | null {
  const d = getDb();
  // 支持前缀查询
  const full = d.prepare("SELECT id FROM sessions WHERE id=? OR id LIKE ? LIMIT 1").all(sessionId, sessionId + "%") as { id: string }[];
  const realId = full[0]?.id;
  if (!realId) return null;
  const s = d.prepare("SELECT * FROM sessions WHERE id=?").get(realId) as Record<string, unknown> | undefined;
  if (!s) return null;
  const sessionIdFull = realId;

  const turns = (d.prepare("SELECT COUNT(*) n FROM turns WHERE session_id=?").get(sessionIdFull) as { n: number }).n;
  const tools = d.prepare("SELECT * FROM tool_calls WHERE session_id=?").all(sessionIdFull) as { name: string; input: unknown }[];
  const thinks = (d.prepare("SELECT COUNT(*) n FROM thinkings WHERE session_id=?").get(sessionIdFull) as { n: number }).n;
  const cost = d.prepare("SELECT COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o FROM costs WHERE session_id=?").get(sessionIdFull) as { i: number; o: number };

  const actions: ActionProfile = { write: 0, read: 0, exec: 0, search: 0, plan: 0 };
  const freq = new Map<string, number>();
  for (const tc of tools) {
    actions[classifyTool(tc.name)]++;
    freq.set(tc.name, (freq.get(tc.name) ?? 0) + 1);
  }
  const topTools = [...freq.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  const touchedFiles = extractTouchedFiles(tools);

  const headline = buildHeadline(actions, turns, touchedFiles);
  return {
    id: sessionId,
    harness: s.harness as string,
    started_at: (s.started_at as string) ?? undefined,
    turns,
    tools: tools.length,
    thinkings: thinks,
    tokensIn: cost.i,
    tokensOut: cost.o,
    touchedFiles,
    topTools,
    actions,
    headline,
  };
}

function buildHeadline(a: ActionProfile, turns: number, files: string[]): string {
  const parts: string[] = [];
  if (a.write > 0) parts.push(`改了 ${a.write} 处文件`);
  if (a.read > 0) parts.push(`查阅 ${a.read} 个文件`);
  if (a.exec > 0) parts.push(`执行 ${a.exec} 条命令`);
  if (a.search > 0) parts.push(`检索 ${a.search} 次`);
  if (a.plan > 0) parts.push(`规划 ${a.plan} 次`);
  const action = parts.join("、") || "以对话为主";
  const fileNote = files.length ? `，涉及 ${files.length} 个文件` : "";
  return `共 ${turns} 回合，${action}${fileNote}`;
}

/** 时段聚合: 按天 -> 会话/项目/工具量/活跃技能 */
export function periodSummary(days = 14): {
  byDay: { date: string; sessions: number; tools: number; tokens: number; projects: string[] }[];
  totals: { sessions: number; tools: number; tokens: number };
} {
  const d = getDb();
  const sessions = d.prepare("SELECT * FROM sessions ORDER BY started_at DESC").all() as {
    id: string;
    started_at: string | null;
    cwd: string | null;
  }[];
  const byDay = new Map<string, { date: string; sessions: number; tools: number; tokens: number; projects: Set<string> }>();
  const cutoff = Date.now() - days * 24 * 3600_000;
  let totS = 0;
  let totTools = 0;
  let totTokens = 0;

  for (const s of sessions) {
    if (!s.started_at) continue;
    const t = new Date(s.started_at).getTime();
    if (t < cutoff) continue;
    const date = s.started_at.slice(0, 10);
    const rec = byDay.get(date) ?? { date, sessions: 0, tools: 0, tokens: 0, projects: new Set<string>() };
    rec.sessions++;
    const tools = (d.prepare("SELECT COUNT(*) n FROM tool_calls WHERE session_id=?").get(s.id) as { n: number }).n;
    rec.tools += tools;
    const cost = (d.prepare("SELECT COALESCE(SUM(input_tokens+output_tokens),0) n FROM costs WHERE session_id=?").get(s.id) as { n: number }).n;
    rec.tokens += cost;
    if (s.cwd) rec.projects.add(s.cwd.split(/[\\/]/).filter(Boolean).slice(-2).join("/"));
    byDay.set(date, rec);
    totS++;
    totTools += tools;
    totTokens += cost;
  }

  return {
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ date: r.date, sessions: r.sessions, tools: r.tools, tokens: r.tokens, projects: [...r.projects] })),
    totals: { sessions: totS, tools: totTools, tokens: totTokens },
  };
}
