/**
 * 数据生命周期管理 (Q1: 轮转与保留策略)
 *
 * - events.log 轮转: 超 5MB 归档, 保留最近3份
 * - pruneOldData: 原始数据保留 N 天(默认90), 之后清理:
 *     空会话先删(无turns), 有turns的会话保留元数据但清原始明细;
 *     聚合/配置/技能不受影响——历史趋势不丢
 */
import { existsSync, statSync, renameSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getDb } from "../db/store.js";

export const EVENTS_LOG = join(homedir(), ".harness-manager", "realtime", "events.log");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const KEEP_ARCHIVES = 3;

/** events.log 轮转: 超过上限归档为 events.log.<ts>, 保留最近3份 */
export function rotateEventsLogIfNeeded(): { rotated: boolean; size: number } {
  if (!existsSync(EVENTS_LOG)) return { rotated: false, size: 0 };
  const size = statSync(EVENTS_LOG).size;
  if (size < MAX_LOG_SIZE) return { rotated: false, size };

  const dir = join(homedir(), ".harness-manager", "realtime");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  renameSync(EVENTS_LOG, join(dir, `events.log.${ts}`));
  const archives = readdirSync(dir)
    .filter((f) => f.startsWith("events.log."))
    .sort()
    .reverse();
  for (const old of archives.slice(KEEP_ARCHIVES)) {
    try {
      unlinkSync(join(dir, old));
    } catch { /* ignore */ }
  }
  return { rotated: true, size };
}

/** 清理过期归档(events.log.<ts> 超过保留期) */
export function pruneArchives(retainDays: number): number {
  const dir = join(homedir(), ".harness-manager", "realtime");
  if (!existsSync(dir)) return 0;
  const cutoff = Date.now() - retainDays * 864e5;
  let removed = 0;
  for (const f of readdirSync(dir)) {
    if (!f.startsWith("events.log.")) continue;
    const fp = join(dir, f);
    try {
      if (statSync(fp).mtimeMs < cutoff) {
        unlinkSync(fp);
        removed++;
      }
    } catch { /* ignore */ }
  }
  return removed;
}

export interface PruneReport {
  sessionsDeleted: number;
  turnsDeleted: number;
  toolCallsDeleted: number;
  thinkingsDeleted: number;
  costsDeleted: number;
  archivesPruned: number;
  retainDays: number;
}

/** 清理 N 天前的原始明细数据; 会话元数据保留(可从事实源重新ingest) */
export function pruneOldData(retainDays = 90): PruneReport {
  const d = getDb();
  const cutoff = new Date(Date.now() - retainDays * 864e5).toISOString();
  const one = (sql: string, ...bind: string[]): number =>
    (d.prepare(sql).run(...bind) as { changes: number }).changes;

  // 1) 老会话的原始明细(以会话结束时间为准)
  const oldSessionIds = (
    d
      .prepare(`SELECT id FROM sessions WHERE COALESCE(ended_at, started_at, ingested_at) < ?`)
      .all(cutoff) as { id: string }[]
  ).map((r) => r.id);

  let turnsDeleted = 0;
  let toolCallsDeleted = 0;
  let thinkingsDeleted = 0;
  let costsDeleted = 0;
  const delFor = (sid: string): void => {
    turnsDeleted += one("DELETE FROM turns WHERE session_id = ?", sid);
    toolCallsDeleted += one("DELETE FROM tool_calls WHERE session_id = ?", sid);
    thinkingsDeleted += one("DELETE FROM thinkings WHERE session_id = ?", sid);
    costsDeleted += one("DELETE FROM costs WHERE session_id = ?", sid);
  };
  oldSessionIds.forEach(delFor);

  // 2) 老归档清理
  const archivesPruned = pruneArchives(retainDays);

  return {
    sessionsDeleted: oldSessionIds.length,
    turnsDeleted,
    toolCallsDeleted,
    thinkingsDeleted,
    costsDeleted,
    archivesPruned,
    retainDays,
  };
}
