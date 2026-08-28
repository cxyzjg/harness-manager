/**
 * P1: turn 粒度推理轨迹 + 会话审查
 *
 * 把会话重建为 turn 序列:
 *   turn = 用户输入 -> [思考 -> 工具批次]* -> 文本回复
 * 每 turn: 输入摘要 / 思考内容 / 工具调用(带入参) / 文本产出 / 上下文构成快照
 *
 * "agent 所见透明化": 每 turn 附 contextAtTurn(至该 turn 开始时 agent 已累计的消息/思考/工具)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** 按 id 定位 pi 会话文件 */
export function findPiSessionFile(id: string): string {
  try {
    const root = join(homedir(), ".pi", "agent", "sessions");
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(dir)) {
        const f = join(dir, e);
        if (statSync(f).isDirectory()) out.push(...walk(f));
        else if (e.endsWith(".jsonl")) out.push(f);
      }
      return out;
    };
    return walk(root).find((f) => f.includes(id.slice(0, 20))) ?? "";
  } catch {
    return "";
  }
}

/** 按 id 定位 CC 会话文件 */
export function findCcSessionFile(id: string): string {
  try {
    const root = join(homedir(), ".claude", "projects");
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(dir)) {
        const f = join(dir, e);
        if (statSync(f).isDirectory()) out.push(...walk(f));
        else if (e.endsWith(".jsonl")) out.push(f);
      }
      return out;
    };
    return walk(root).find((f) => f.includes(id.slice(0, 20))) ?? "";
  } catch {
    return "";
  }
}

export interface TurnToolCall {
  name: string;
  input?: string; // 摘要
  id?: string;
}

export interface Turn {
  index: number;
  ts?: string;
  userInput: string; // 摘要
  thinking: { text: string }[]; // 思考段
  tools: TurnToolCall[];
  textOutput: string[]; // 回复文本(摘要)
  contextAtTurn: { messages: number; thinking: number; tools: number };
}

export interface TurnView {
  sessionId: string;
  totalTurns: number;
  turns: Turn[];
  totals: { tools: number; thinking: number; messages: number };
}

interface RawContent {
  type: string;
  thinking?: string;
  text?: string;
  name?: string;
  id?: string;
  arguments?: unknown;
  input?: unknown;
}

/** 解析 pi 会话文件 -> turn 视图 */
export function buildTurnViewFromPiFile(sessionFile: string, sessionId: string): TurnView | null {
  let lines: string[];
  try {
    lines = readFileSync(sessionFile, "utf-8").split("\n").filter(Boolean);
  } catch {
    return null;
  }

  const turns: Turn[] = [];
  let cur: Turn | null = null;
  let totalMsgs = 0;
  let ctx = { messages: 0, thinking: 0, tools: 0 };
  let totalTools = 0;
  let totalThinking = 0;

  for (const line of lines) {
    let ev: { type?: string; id?: string; timestamp?: string; message?: { role?: string; content?: unknown } };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type !== "message" || !ev.message?.role) continue;
    const content = Array.isArray(ev.message.content) ? (ev.message.content as RawContent[]) : [];
    totalMsgs++;
    ctx.messages++;
    const role = ev.message.role;

    if (role === "user") {
      if (cur) turns.push(cur);
      cur = {
        index: turns.length + 1,
        ts: ev.timestamp,
        userInput: firstText(content).slice(0, 120),
        thinking: [],
        tools: [],
        textOutput: [],
        contextAtTurn: { ...ctx },
      };
      continue;
    }
    if (!cur) continue; // 会话头部 assistant 消息(无对应用户输入,如 resume)
    for (const c of content) {
      if (c.type === "thinking" && c.thinking) {
        cur.thinking.push({ text: c.thinking });
        ctx.thinking++;
        totalThinking++;
      } else if (c.type === "toolCall") {
        const inp = c.arguments ?? c.input;
        cur.tools.push({ name: c.name ?? "?", id: c.id, input: summarize(inp, 90) });
        ctx.tools++;
        totalTools++;
      } else if (c.type === "text" && c.text) {
        cur.textOutput.push(c.text.slice(0, 200));
      }
    }
  }
  if (cur) turns.push(cur);

  if (!turns.length) return null;
  return { sessionId, totalTurns: turns.length, turns, totals: { tools: totalTools, thinking: totalThinking, messages: totalMsgs } };
}

/** CC 会话文件 -> turn 视图(CC 事件: user/assistant/tool_use/tool_result) */
export function buildTurnViewFromCcFile(sessionFile: string, sessionId: string): TurnView | null {
  let lines: string[];
  try {
    lines = readFileSync(sessionFile, "utf-8").split("\n").filter(Boolean);
  } catch {
    return null;
  }
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  let ctx = { messages: 0, thinking: 0, tools: 0 };

  for (const line of lines) {
    let ev: { type?: string; timestamp?: string; message?: { content?: unknown }; name?: string; input?: unknown; tool_use_id?: string };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "user" || ev.type === "assistant") {
      ctx.messages++;
      const content = Array.isArray(ev.message?.content) ? (ev.message!.content as RawContent[]) : [];
      if (ev.type === "user") {
        if (cur) turns.push(cur);
        cur = {
          index: turns.length + 1,
          ts: ev.timestamp,
          userInput: firstText(content).slice(0, 120),
          thinking: [],
          tools: [],
          textOutput: [],
          contextAtTurn: { ...ctx },
        };
      } else if (cur) {
        for (const c of content) {
          if (c.type === "thinking" && c.thinking) { cur.thinking.push({ text: c.thinking }); ctx.thinking++; }
          else if (c.type === "toolCall" || c.type === "tool_use") {
            cur.tools.push({ name: c.name ?? "?", id: c.id, input: summarize(c.input ?? c.arguments, 90) });
            ctx.tools++;
          } else if (c.type === "text" && c.text) cur.textOutput.push(c.text.slice(0, 200));
        }
      }
    } else if (ev.type === "tool_use" && cur) {
      cur.tools.push({ name: ev.name ?? "?", id: ev.tool_use_id, input: summarize(ev.input, 90) });
      ctx.tools++;
    }
  }
  if (cur) turns.push(cur);
  if (!turns.length) return null;
  const totalTools = turns.reduce((a, t) => a + t.tools.length, 0);
  const totalThinking = turns.reduce((a, t) => a + t.thinking.length, 0);
  return { sessionId, totalTurns: turns.length, turns, totals: { tools: totalTools, thinking: totalThinking, messages: ctx.messages } };
}

function firstText(content: RawContent[]): string {
  for (const c of content) {
    if (c.type === "text" && c.text) return c.text;
  }
  return "(non-text)";
}

function summarize(input: unknown, max: number): string {
  if (input == null) return "";
  const s = typeof input === "string" ? input : JSON.stringify(input);
  if (!s) return "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max) + "…" : one;
}
