/**
 * Claude Code harness adapter: projects/*.jsonl -> 统一模型 (docs/SCHEMA.md)
 * CC 事件: user/assistant(message.content 数组含 text/thinking/tool_use), tool_use, tool_result, usage
 * 容错(D2): 单行失败跳过; usage 缺失则无 Cost 记录。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  UnifiedSession,
  Turn,
  ThinkingBlock,
  ToolCallRecord,
  IngestResult,
} from "../core/schema.js";

export function ccAvailable(): boolean {
  return existsSync(join(homedir(), ".claude", "projects"));
}

export function ccListSessions(): { fileId: string; path: string }[] {
  const root = join(homedir(), ".claude", "projects");
  if (!existsSync(root)) return [];
  const out: { fileId: string; path: string }[] = [];
  for (const proj of readdirSync(root)) {
    const dir = join(root, proj);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".jsonl")) out.push({ fileId: f.replace(/\.jsonl$/, ""), path: join(dir, f) });
    }
  }
  return out;
}

interface CcEv {
  type?: string;
  timestamp?: string;
  toolUseId?: string;
  tool_use_id?: string;
  name?: string;
  input?: unknown;
  parentToolUseId?: string;
  message?: { role?: string; model?: string; content?: unknown; usage?: { input_tokens?: number; output_tokens?: number } };
}

export function ccParse(file: string): IngestResult {
  const fileId = file.split(/[\\/]/).pop()!.replace(/\.jsonl$/, "");
  const sessionId = `claude:${fileId}`;
  const res: IngestResult = { session: null, turns: [], thinkings: [], tool_calls: [], costs: [], errors: [] };

  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch (e) {
    res.errors.push({ file, reason: `读取失败: ${(e as Error).message}` });
    return res;
  }

  let degraded = false;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let model: string | undefined;
  const turns: Turn[] = [];
  let curTurn: Turn | null = null;
  let msgCount = 0;
  let thinkCount = 0;
  let toolCount = 0;
  let thinkIdx = 0;
  // turn 内工具时间戳, 用于 duration
  const openTools = new Map<string, { startedAt?: string }>();

  const lines = raw.split("\n").filter(Boolean);
  for (let ln = 0; ln < lines.length; ln++) {
    let ev: CcEv;
    try {
      ev = JSON.parse(lines[ln]);
    } catch {
      degraded = true;
      res.errors.push({ file, line: ln + 1, reason: "JSON 解析失败, 该行跳过" });
      continue;
    }
    if (ev.timestamp) endedAt = ev.timestamp;

    if (ev.type === "assistant" || ev.type === "user") {
      msgCount++;
      startedAt = startedAt ?? ev.timestamp;
      const content = Array.isArray(ev.message?.content) ? (ev.message!.content as RawContent[]) : [];
      if (ev.message?.model) model = ev.message.model;

      if (ev.type === "user") {
        curTurn = {
          id: `${sessionId}:t${turns.length + 1}`,
          session_id: sessionId,
          idx: turns.length + 1,
          ts: ev.timestamp,
          user_input: firstText(content).slice(0, 4000),
          context_before: { messages: msgCount - 1, thinking: thinkCount, tools: toolCount },
        };
        turns.push(curTurn);
        continue;
      }
      if (!curTurn) continue;

      const usage = ev.message?.usage;
      if (usage && (usage.input_tokens || usage.output_tokens)) {
        res.costs.push({
          session_id: sessionId,
          model,
          input_tokens: usage.input_tokens ?? 0,
          output_tokens: usage.output_tokens ?? 0,
          recorded_at: ev.timestamp,
        });
      }

      for (const c of content) {
        if (c.type === "thinking" && c.thinking) {
          res.thinkings.push({ session_id: sessionId, turn_id: curTurn.id, idx: ++thinkIdx, content: c.thinking.slice(0, 8000), ts: ev.timestamp });
          thinkCount++;
        } else if (c.type === "toolCall" || c.type === "tool_use") {
          toolCount++;
          const tcId = c.id ?? `cc-${toolCount}`;
          openTools.set(tcId, { startedAt: ev.timestamp });
          res.tool_calls.push({
            id: tcId,
            session_id: sessionId,
            turn_id: curTurn.id,
            name: c.name ?? "unknown",
            input: truncate(c.input ?? c.arguments),
            started_at: ev.timestamp,
            is_error: false,
          });
        } else if (c.type === "text" && c.text) {
          // 文本产出留在原始文件; 不建独立实体(schema v1 无 TextOutput 表)
        }
      }
    } else if (ev.type === "tool_use" && curTurn) {
      toolCount++;
      const tcId = ev.toolUseId ?? ev.tool_use_id ?? `cc-${toolCount}`;
      openTools.set(tcId, { startedAt: ev.timestamp });
      res.tool_calls.push({
        id: tcId,
        session_id: sessionId,
        turn_id: curTurn.id,
        name: ev.name ?? "unknown",
        input: truncate(ev.input),
        started_at: ev.timestamp,
        is_error: false,
      });
    } else if (ev.type === "tool_result") {
      const tid: string = ev.tool_use_id ?? "";
      const t = res.tool_calls.find((x) => x.id === tid);
      if (t) {
        t.output = truncate(ev.input);
        t.ended_at = ev.timestamp;
        const startedAtStr: string | undefined = openTools.get(tid)?.startedAt;
        const endedAtStr: string | undefined = ev.timestamp;
        const startMs = startedAtStr ? Date.parse(startedAtStr) : NaN;
        const endMs2 = endedAtStr ? Date.parse(endedAtStr) : NaN;
        const dur = endMs2 - startMs;
        if (!Number.isNaN(dur) && dur >= 0) t.duration_ms = dur;
        if (/error|denied|failed/i.test(String(t.output ?? "").slice(0, 200))) t.is_error = true;
      }
    }
  }

  if (msgCount === 0) {
    res.errors.push({ file, reason: "空会话(无消息)" });
    return res;
  }

  res.session = {
    id: sessionId,
    harness: "claude",
    cwd: guessCwd(file),
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

/** projects 目录名 -> cwd 候选(pi trust 路径匹配不可用时的降级展示) */
function guessCwd(file: string): string | undefined {
  const m = file.match(/[\\/]projects[\\/]([^\\/]+)[\\/]/);
  return m ? m[1] : undefined;
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
