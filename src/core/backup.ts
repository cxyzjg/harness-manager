/**
 * 备份与导出 (Q2)
 *
 * - hm backup: db.sqlite 快照(保留最近 N 份)
 * - hm export <session>: 单会话 Markdown 报告(审查回放的可读版)
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { dataDir } from "../config.js";
import { getDb, getTurns, getToolCalls, getThinkings, getSession } from "../db/store.js";
import { contextTimeline } from "../db/contextEstimator.js";
import { summarizeSession } from "../db/summary.js";

const KEEP_BACKUPS = 5;

/** db 快照: 用 sqlite backup API(处理WAL), 保留最近 N 份 */
export async function backupDb(): Promise<{ file: string; size: number; kept: number }> {
  const dir = dataDir();
  const backupDir = join(dir, "backups");
  mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const target = join(backupDir, `db-${ts}.sqlite`);
  await getDb().backup(target);
  // 清理旧备份(排除刚创建的 target; 且容忍并发删除)
  const backups = readdirSync(backupDir)
    .filter((f) => f.startsWith("db-") && f.endsWith(".sqlite") && f !== "db-" + ts + ".sqlite")
    .sort()
    .reverse();
  for (const old of backups.slice(KEEP_BACKUPS - 1)) {
    const fp = join(backupDir, old);
    try {
      if (existsSync(fp)) unlinkSync(fp);
    } catch { /* ignore */ }
  }
  return { file: target, size: existsSync(target) ? statSync(target).size : 0, kept: Math.min(KEEP_BACKUPS, backups.length + 1) };
}

/** 单会话 Markdown 报告导出 */
export function exportSessionMarkdown(sessionId: string, outDir?: string): { file: string; content: string } | null {
  const s = getSession(sessionId); // 支持前缀
  if (!s) return null;
  const turns = getTurns(s.id);
  const tools = getToolCalls(s.id);
  const thinks = getThinkings(s.id);
  const ctx = contextTimeline(s.id).slice(-1)[0];
  const sum = summarizeSession(s.id);

  const toolsByTurn = new Map<string, typeof tools>();
  for (const tc of tools) {
    const key = tc.turn_id ?? "no-turn";
    const arr = toolsByTurn.get(key) ?? [];
    arr.push(tc);
    toolsByTurn.set(key, arr);
  }

  const lines: string[] = [];
  lines.push(`# 会话审查报告: ${s.id}`);
  lines.push("");
  lines.push(`- harness: ${s.harness}`);
  lines.push(`- 项目: ${s.cwd ?? "-"}`);
  lines.push(`- 开始: ${s.started_at ?? "-"} | 结束: ${s.ended_at ?? "-"}`);
  lines.push(`- 模型: ${s.model ?? "-"}`);
  lines.push(`- 规模: ${turns.length} turns / ${tools.length} 工具调用 / ${thinks.length} 思考块`);
  if (ctx?.actualTotalTokens) lines.push(`- 峰值上下文: ${ctx.actualTotalTokens.toLocaleString()} tokens (实测)`);
  lines.push("");
  if (sum) {
    lines.push(`## 摘要`);
    lines.push("");
    lines.push(sum.headline);
    lines.push("");
    if (sum.touchedFiles.length) {
      lines.push(`### 改动文件 (${sum.touchedFiles.length})`);
      sum.touchedFiles.forEach((f) => lines.push(`- ${f}`));
      lines.push("");
    }
  }
  lines.push(`## 调用轨迹`);
  lines.push("");
  for (const t of turns) {
    lines.push(`### Turn ${t.idx}  \`${(t.ts ?? "").slice(0, 19)}\``);
    lines.push("");
    lines.push(`**用户**: ${t.user_input.slice(0, 500)}`);
    const th = thinks.filter((x) => x.turn_id === t.id);
    for (const x of th.slice(0, 3)) {
      lines.push("");
      lines.push(`> 💭 ${x.content.replace(/\s+/g, " ").slice(0, 300)}…`);
    }
    for (const tc of toolsByTurn.get(t.id) ?? []) {
      lines.push("");
      lines.push(`- 🛠 **${tc.name}** ${tc.input ? " \`" + String(tc.input).slice(0, 120) + "\`" : ""}${tc.duration_ms ? ` (${tc.duration_ms}ms)` : ""}${tc.is_error ? " ⚠️错误" : ""}`);
    }
    const cb = t.context_before;
    if (cb) lines.push(`- 📐 当时所见: ${cb.messages} 消息 / ${cb.thinking} 思考 / ${cb.tools} 工具`);
    lines.push("");
  }
  const content = lines.join("\n");
  const dir = outDir ?? join(homedir(), ".harness-manager", "exports");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `session-${s.id.replace(/[\\/:]/g, "_").slice(0, 60)}.md`);
  writeFileSync(file, content);
  return { file, content };
}
