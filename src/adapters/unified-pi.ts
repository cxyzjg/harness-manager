/**
 * pi harness adapter: 私有 JSONL 树格式 -> 统一模型 (docs/SCHEMA.md)
 * 容错(D2): 单行失败跳过记 errors; turn 结构缺失时工具挂到首个turn。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  UnifiedSession,
  Turn,
  ThinkingBlock,
  ToolCallRecord,
  CostRecord,
  IngestResult,
} from "../core/schema.js";

export function piAvailable(): boolean {
  return existsSync(join(homedir(), ".pi", "agent", "sessions"));
}

/** 列出全部会话文件 */
export function piListSessions(): { fileId: string; path: string }[] {
  const root = join(homedir(), ".pi", "agent", "sessions");
  if (!existsSync(root)) return [];
  const out: { fileId: string; path: string }[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const f = join(dir, e);
      if (statSync(f).isDirectory()) walk(f);
      else if (e.endsWith(".jsonl")) out.push({ fileId: e.replace(/\.jsonl$/, ""), path: f });
    }
  };
  walk(root);
  return out;
}

interface PiEv {
  type?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  cwd?: string;
  provider?: string;
  modelId?: string;
  message?: { role?: string; content?: unknown; usage?: { input?: number; output?: number }; model?: string };
}

/** 解析单个 pi 会话文件 -> 统一模型 */
export function piParse(file: string): IngestResult {
  const fileId = file.split(/[\\/]/).pop()!.replace(/\.jsonl$/, "");
  const sessionId = `pi:${fileId}`;
  const res: IngestResult = { session: null, turns: [], thinkings: [], tool_calls: [], costs: [], errors: [] };

  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch (e) {
    res.errors.push({ file, reason: `读取失败: ${(e as Error).message}` });
    return res;
  }

  let degraded = false;
  let cwd: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let model: string | undefined;

  // turn 构建
  const turns: Turn[] = [];
  let curTurn: Turn | null = null;
  let msgCount = 0;
  let thinkCount = 0;
  let toolCount = 0;
  let thinkIdx = 0;
  let firstTurnMade = false;

  const lines = raw.split("\n").filter(Boolean);
  for (let ln = 0; ln < lines.length; ln++) {
    let ev: PiEv;
    try {
      ev = JSON.parse(lines[ln]);
    } catch {
      degraded = true;
      res.errors.push({ file, line: ln + 1, reason: "JSON 解析失败, 该行跳过" });
      continue;
    }

    if (ev.timestamp) endedAt = ev.timestamp;
    if (ev.type === "session") {
      cwd = ev.cwd ?? cwd;
      startedAt = startedAt ?? ev.timestamp;
      continue;
    }
    if (ev.type === "model_change") {
      model = model ?? ev.modelId ?? ev.provider;
      continue;
    }
    if (ev.type === "usage") {
      const u = (ev as unknown as { input?: number; output?: number }) ?? {};
      res.costs.push({
        session_id: sessionId,
        model,
        input_tokens: u.input ?? 0,
        output_tokens: u.output ?? 0,
        recorded_at: ev.timestamp,
      });
      continue;
    }
    if (ev.type !== "message" || !ev.message?.role) continue;

    msgCount++;
    const role = ev.message.role;
    const content = Array.isArray(ev.message.content) ? (ev.message.content as RawContent[]) : [];

    if (role === "user") {
      curTurn = {
        id: `${sessionId}:t${turns.length + 1}`,
        session_id: sessionId,
        idx: turns.length + 1,
        ts: ev.timestamp,
        user_input: firstText(content).slice(0, 4000),
        context_before: { messages: msgCount - 1, thinking: thinkCount, tools: toolCount },
      };
      turns.push(curTurn);
      firstTurnMade = true;
      continue;
    }
    if (!curTurn) {
      // 头部无对应用户输入(如 resume): 归入一个合成turn
      curTurn = {
        id: `${sessionId}:t0`,
        session_id: sessionId,
        idx: 0,
        ts: ev.timestamp,
        user_input: "(续接的头部消息)",
        context_before: { messages: msgCount - 1, thinking: 0, tools: 0 },
      };
      turns.unshift(curTurn); // t0 排最前
    }

    for (const c of content) {
      if (c.type === "thinking" && c.thinking) {
        res.thinkings.push({ session_id: sessionId, turn_id: curTurn.id, idx: ++thinkIdx, content: c.thinking.slice(0, 8000), ts: ev.timestamp });
        thinkCount++;
      } else if (c.type === "toolCall") {
        toolCount++;
        res.tool_calls.push({
          id: c.id ?? `${curTurn.id}:tc${toolCount}`,
          session_id: sessionId,
          turn_id: curTurn.id,
          name: c.name ?? "unknown",
          input: truncate(c.arguments ?? c.input),
          started_at: ev.timestamp,
          is_error: false, // pi 源不记录结果错误
        });
      }
    }
  }
  void firstTurnMade;

  if (msgCount === 0 && res.tool_calls.length === 0) {
    res.errors.push({ file, reason: "空会话(无消息)" });
    return res;
  }

  res.session = {
    id: sessionId,
    harness: "pi",
    cwd,
    started_at: startedAt,
    ended_at: endedAt,
    model,
    degraded,
    source_file: file,
  };
  res.turns = turns;
  return res;
}

interface RawContent {
  type?: string;
  thinking?: string;
  text?: string;
  name?: string;
  id?: string;
  arguments?: unknown;
  input?: unknown;
}

function firstText(content: RawContent[]): string {
  for (const c of content) if (c.type === "text" && c.text) return c.text;
  return "(non-text)";
}

function truncate(v: unknown): unknown {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (s == null) return v;
    return s.length > 2000 ? s.slice(0, 2000) + "…" : v;
  } catch {
    return String(v);
  }
}
