/**
 * Codex harness adapter (骨架, SCHEMA.md 契约)
 * 本机 ~/.codex/sessions 尚无数据 —— 基于 codex-rs 分析文档的 rollout 格式实现,
 * 一旦有真实数据立即生效; 在此之前 available()=false 不参与 ingest。
 *
 * rollout JSONL 行类型(RolloutItem):
 *   {type:"session_meta", payload:{id,cwd,...}}
 *   {type:"response_item", payload:{type:"message"|"function_call"|"reasoning"|..., role?, content[]}}
 *   {type:"event_msg", payload:{type:"token_count", input_tokens, output_tokens}}
 *   {type:"compacted", ...}
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { IngestResult } from "../core/schema.js";

export function codexAvailable(): boolean {
  const root = join(homedir(), ".codex", "sessions");
  if (!existsSync(root)) return false;
  return hasJsonl(root);
}

function hasJsonl(dir: string): boolean {
  try {
    for (const e of readdirSync(dir)) {
      const f = join(dir, e);
      let isDir = false;
      try {
        isDir = statSync(f).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (hasJsonl(f)) return true;
      } else if (e.endsWith(".jsonl")) return true;
    }
  } catch { /* ignore */ }
  return false;
}

export function codexListSessions(): { fileId: string; path: string }[] {
  const root = join(homedir(), ".codex", "sessions");
  if (!existsSync(root)) return [];
  const out: { fileId: string; path: string }[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const f = join(dir, e);
      let isDir = false;
      try {
        isDir = statSync(f).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(f);
      else if (e.endsWith(".jsonl")) out.push({ fileId: e.replace(/\.jsonl$/, ""), path: f });
    }
  };
  walk(root);
  return out;
}

export function codexParse(file: string): IngestResult {
  // 结构就绪: 等到有真实数据后按样本微调字段映射
  const res: IngestResult = { session: null, turns: [], thinkings: [], tool_calls: [], costs: [], errors: [] };
  res.errors.push({ file, reason: "codex 适配器待真实数据校准(骨架)" });
  return res;
}
