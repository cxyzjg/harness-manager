/**
 * 实时监控采集器（Step 3）
 *
 * 读取 pi extension 写入的 ~/.harness-manager/realtime/events.log，
 * 提供滚动窗口统计（最近 1h / 24h / 全部）：
 *  - 工具调用频率
 *  - 正在发生的会话
 *  - 最近事件流
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface LiveEvent {
  ts: string;
  type: "tool_call" | "session_start" | "session_shutdown" | "skill_trigger" | "compaction" | "model_change" | "assistant_message" | "tool_result";
  toolName?: string;
  input?: unknown;
  sessionId?: string;
  cwd?: string;
  reason?: string;
  skills?: string[];
  prompt?: string;
  entries?: number;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  thinking?: string;
  text?: string;
  tools?: { name?: string; input?: unknown }[];
  isError?: boolean;
  toolCallId?: string;
  contentExcerpt?: string;
}

export interface LiveSnapshot {
  active: boolean; // extension 是否在记录
  logPath: string;
  logSize: number;
  lastEvent?: LiveEvent;
  // 滚动窗口
  window1h: ToolWindow;
  window24h: ToolWindow;
  activeSessions: string[];
  recent: LiveEvent[];
}

interface ToolWindow {
  toolCalls: number;
  byTool: Record<string, number>;
}

function logPath(): string {
  return join(homedir(), ".harness-manager", "realtime", "events.log");
}

/** 读取全部事件 */
export function readLiveEvents(max = 5000): LiveEvent[] {
  const p = logPath();
  if (!existsSync(p)) return [];
  try {
    const raw = readFileSync(p, "utf-8").split("\n").filter(Boolean);
    const events: LiveEvent[] = [];
    // 只取最后 max 行（避免超大文件）
    const tail = raw.slice(-max);
    for (const line of tail) {
      try {
        const e = JSON.parse(line) as LiveEvent;
        if (e && e.ts && e.type) events.push(e);
      } catch {
        /* 跳过损坏行 */
      }
    }
    return events;
  } catch {
    return [];
  }
}

/** 生成实时快照 */
export function liveSnapshot(hours1h = 1, hours24h = 24): LiveSnapshot {
  const events = readLiveEvents(5000);
  const now = Date.now();
  const h1 = now - hours1h * 3600 * 1000;
  const h24 = now - hours24h * 3600 * 1000;

  const toolEvents = events.filter((e) => e.type === "tool_call");

  const window = (from: number): ToolWindow => {
    const w = toolEvents.filter((e) => new Date(e.ts).getTime() >= from);
    const byTool: Record<string, number> = {};
    for (const e of w) {
      const t = e.toolName ?? "unknown";
      byTool[t] = (byTool[t] ?? 0) + 1;
    }
    return { toolCalls: w.length, byTool };
  };

  // 活跃会话：最近 30 分钟有 tool_call 或 session_start 未 shutdown
  const recentStart = now - 30 * 60 * 1000;
  const activeSessions = new Set<string>();
  for (const e of events) {
    if (new Date(e.ts).getTime() < recentStart) continue;
    if (e.type === "session_start" && e.sessionId) activeSessions.add(e.sessionId);
    if (e.type === "tool_call" && e.sessionId) activeSessions.add(e.sessionId);
    if (e.type === "session_shutdown" && e.sessionId) activeSessions.delete(e.sessionId);
  }

  const p = logPath();
  const logSize = existsSync(p) ? statSync(p).size : 0;
  const lastEvent = events.length ? events[events.length - 1] : undefined;

  return {
    active: logSize > 0,
    logPath: p,
    logSize,
    lastEvent,
    window1h: window(h1),
    window24h: window(h24),
    activeSessions: [...activeSessions],
    recent: events.slice(-20).reverse(), // 最近 20 条，最新在前
  };
}
