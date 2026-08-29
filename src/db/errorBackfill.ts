/**
 * 实时错误回填(①补pi错误率)
 *
 * pi extension 的 tool_result 事件记录 isError, 写入 events.log。
 * 本模块扫描这些事件, 按 toolCallId 匹配 SQLite tool_calls 更新 is_error,
 * 让 pi 源会话也有真实错误率(而不是恒为0)。
 *
 * 注: toolCallId 是 pi 会话内唯一; 同一 id 可能跨会话重复, 按"会话+工具+时间邻近"尽量精确。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../config.js";
import { homedir } from "node:os";
import { getDb } from "./store.js";

export function backfillErrors(): { scanned: number; errorsFound: number; updated: number } {
  const p = join(dataDir(), "realtime", "events.log");
  if (!existsSync(p)) return { scanned: 0, errorsFound: 0, updated: 0 };
  const d = getDb();
  let scanned = 0;
  let errorsFound = 0;
  let updated = 0;

  const lines = readFileSync(p, "utf-8").split("\n").filter(Boolean);
  for (const line of lines) {
    let e: { type?: string; toolCallId?: string; isError?: boolean; toolName?: string; ts?: string };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type !== "tool_result" || !e.toolCallId || e.isError !== true) continue;
    scanned++;
    errorsFound++;
    // 匹配 tool_calls: id 精确 + 工具名 + 时间邻近(1分钟内)
    const t = e.ts ? Date.parse(e.ts) : NaN;
    const rows = d
      .prepare("SELECT id, session_id, name, started_at FROM tool_calls WHERE id=? ORDER BY started_at DESC")
      .all(e.toolCallId) as { id: string; session_id: string; name: string; started_at: string | null }[];
    for (const row of rows) {
      if (e.toolName && row.name && e.toolName.toLowerCase() !== row.name.toLowerCase()) continue;
      if (!Number.isNaN(t) && row.started_at) {
        const diff = Math.abs(Date.parse(row.started_at) - t);
        if (diff > 60_000) continue; // 超过1分钟视为不匹配
      }
      const r = d.prepare("UPDATE tool_calls SET is_error=1 WHERE session_id=? AND id=?").run(row.session_id, row.id);
      updated += r.changes;
    }
  }
  return { scanned, errorsFound, updated };
}
