/**
 * 上下文构成估算与回填 (v2 功能#6 上下文管理)
 *
 * SCHEMA v2.1 D5: 每turn上下文拆 system_prompt/history/tool_result/file_content 四段token。
 * 精确拆分需要LLM端usage明细, 本地只能估算 —— 口径统一为 chars/3 (中英混合经验值)。
 *
 * 每 turn 的"当时上下文" = 该 turn 开始前累计的一切:
 *   system_prompt  : config_snapshot 实测(有则用) 或 粗估
 *   history        : 之前所有 turn 的 user_input + thinking 字符累计
 *   tool_result    : 之前所有工具的 input+output 字符
 *   file_content   : read 类工具的 output 字符(文件内容的主要来源)
 */
import { readFileSync, existsSync } from "node:fs";
import { getDb } from "./store.js";

const READ_TOOLS = new Set(["read", "cat", "view"]);

interface TurnRow {
  id: string;
  idx: number;
  user_input: string;
}
interface ToolRow {
  turn_id: string | null;
  name: string;
  input: string | null;
  output: string | null;
}

/** 单会话回填: 逐turn估算四段token并写入 context_snapshots */
export function estimateContextForSession(sessionId: string): { turns: number; updated: number } {
  const d = getDb();
  const s = d.prepare("SELECT id, agent_config_ref FROM sessions WHERE id=?").get(sessionId) as
    | { id: string; agent_config_ref?: string }
    | undefined;
  if (!s) return { turns: 0, updated: 0 };

  // system_prompt 实测值(有配置快照则用其长度/3)
  let sysTok: number | null = null;
  if (s.agent_config_ref) {
    const cfg = d.prepare("SELECT LENGTH(system_prompt) AS len FROM agent_configs WHERE id=?").get(s.agent_config_ref) as {
      len: number | null;
    } | undefined;
    if (cfg?.len) sysTok = Math.round(cfg.len / 3);
  }

  const turnRows = d
    .prepare("SELECT id, idx, user_input FROM turns WHERE session_id=? ORDER BY idx")
    .all(sessionId) as unknown as TurnRow[];
  if (!turnRows.length) return { turns: 0, updated: 0 };
  const firstTurnId = turnRows[0].id;

  // 工具按 turn 归组(无 turn_id 的挂首turn)
  const allTools = d
    .prepare("SELECT turn_id, name, input, output FROM tool_calls WHERE session_id=?")
    .all(sessionId) as unknown as ToolRow[];
  const toolByTurn = new Map<string, ToolRow[]>();
  for (const tc of allTools) {
    const key = tc.turn_id ?? firstTurnId;
    const arr = toolByTurn.get(key) ?? [];
    arr.push(tc);
    toolByTurn.set(key, arr);
  }
  const thinkCharsByTurn = new Map<string, number>();
  for (const th of d.prepare("SELECT turn_id, LENGTH(content) n FROM thinkings WHERE session_id=?").all(sessionId) as unknown as {
    turn_id: string | null;
    n: number | null;
  }[]) {
    const key = th.turn_id ?? firstTurnId;
    thinkCharsByTurn.set(key, (thinkCharsByTurn.get(key) ?? 0) + (th.n ?? 0));
  }

  // 流动累计器
  let histChars = 0;
  let toolChars = 0;
  let fileChars = 0;
  let updated = 0;

  // UPSERT: 只更新估算四段, 不覆盖实测 actual_total_tokens
  const upStmt = d.prepare(
    `INSERT INTO context_snapshots (turn_id, system_prompt_tokens, history_tokens, tool_result_tokens, file_content_tokens, snapshot_at)
     VALUES (@turn_id,@system_prompt_tokens,@history_tokens,@tool_result_tokens,@file_content_tokens,@snapshot_at)
     ON CONFLICT(turn_id) DO UPDATE SET
       system_prompt_tokens=@system_prompt_tokens, history_tokens=@history_tokens,
       tool_result_tokens=@tool_result_tokens, file_content_tokens=@file_content_tokens, snapshot_at=@snapshot_at`
  );

  for (const t of turnRows) {
    const sysP = sysTok ?? 1200; // 无实测时假设基础系统提示~400tok
    const histTok = Math.round(histChars / 3);
    const toolTok = Math.round(toolChars / 3);
    const fileTok = Math.round(fileChars / 3);

    upStmt.run({ turn_id: t.id, system_prompt_tokens: sysP, history_tokens: histTok, tool_result_tokens: toolTok, file_content_tokens: fileTok, snapshot_at: new Date().toISOString() });
    updated++;

    // 本回合结束后的累计(供下一 turn 的"当时上下文")
    histChars += (t.user_input ?? "").length;
    for (const tc of toolByTurn.get(t.id) ?? []) {
      const inLen = (tc.input ?? "").length;
      const outLen = (tc.output ?? "").length;
      toolChars += inLen + outLen;
      if (READ_TOOLS.has(tc.name)) fileChars += outLen;
    }
    histChars += thinkCharsByTurn.get(t.id) ?? 0;
  }

  return { turns: turnRows.length, updated };
}

/** 读取某会话的上下文演变序列(已估算的快照) */
export function contextTimeline(sessionId: string): {
  turnIdx: number;
  systemPromptTokens: number | null;
  historyTokens: number | null;
  toolResultTokens: number | null;
  fileContentTokens: number | null;
  actualTotalTokens?: number;
  totalEstimated: number;
}[] {
  const d = getDb();
  const rows = d
    .prepare(`SELECT t.idx AS turnIdx, cs.system_prompt_tokens, cs.history_tokens, cs.tool_result_tokens, cs.file_content_tokens, cs.actual_total_tokens
              FROM context_snapshots cs JOIN turns t ON t.id = cs.turn_id
              WHERE t.session_id=? ORDER BY t.idx`)
    .all(sessionId) as {
    turnIdx: number;
    system_prompt_tokens: number | null;
    history_tokens: number | null;
    tool_result_tokens: number | null;
    file_content_tokens: number | null;
    actual_total_tokens: number | null;
  }[];
  return rows.map((r) => {
    const total = (r.system_prompt_tokens ?? 0) + (r.history_tokens ?? 0) + (r.tool_result_tokens ?? 0) + (r.file_content_tokens ?? 0);
    return {
      turnIdx: r.turnIdx,
      systemPromptTokens: r.system_prompt_tokens,
      historyTokens: r.history_tokens,
      toolResultTokens: r.tool_result_tokens,
      fileContentTokens: r.file_content_tokens,
      actualTotalTokens: r.actual_total_tokens ?? undefined,
      totalEstimated: total,
    };
  });
}

/** 便捷: 从 pi 会话文件路径读原始文件大小(调试用, 未用可删) */
export function sessionFileSize(file: string): number {
  try {
    return readFileSync(file).length;
  } catch {
    return existsSync(file) ? -1 : 0;
  }
}
