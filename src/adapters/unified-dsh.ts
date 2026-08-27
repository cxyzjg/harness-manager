/**
 * dsh (DeepSeek Harness) adapter (骨架, SCHEMA.md 契约)
 * 本机尚未使用 dsh。dsh 是"一切皆插件"架构, 会话根目录可配置
 * (--session-root / 默认未定), 结构待首个真实样本确认。
 *
 * 已知事实(来自 dsh 仓库 docs):
 *   - provider id 持久化在会话日志里
 *   - session root 可通过 CLI 配置
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { IngestResult } from "../core/schema.js";

/** 候选数据目录(dsh 默认与常见配置) */
function candidateRoots(): string[] {
  return [
    join(homedir(), ".dsh", "sessions"),
    join(homedir(), ".deepseek-harness", "sessions"),
    join(homedir(), ".config", "dsh", "sessions"),
  ];
}

export function dshAvailable(): boolean {
  return candidateRoots().some((r) => existsSync(r));
}

export function dshListSessions(): { fileId: string; path: string }[] {
  for (const root of candidateRoots()) {
    if (!existsSync(root)) continue;
    const out: { fileId: string; path: string }[] = [];
    try {
      for (const e of readdirSync(root)) {
        if (e.endsWith(".jsonl")) out.push({ fileId: e.replace(/\.jsonl$/, ""), path: join(root, e) });
      }
    } catch { /* ignore */ }
    return out;
  }
  return [];
}

export function dshParse(file: string): IngestResult {
  const res: IngestResult = { session: null, turns: [], thinkings: [], tool_calls: [], costs: [], errors: [] };
  res.errors.push({ file, reason: "dsh 适配器待真实数据校准(骨架)" });
  return res;
}
