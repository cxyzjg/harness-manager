/**
 * 去重候选检测（SPEC FR-1）
 * - 同名: 不同来源/目录出现同名 → 候选
 * - 功能重叠: 描述关键词聚类（跨来源）
 */
import type { HarnessResource } from "../types.js";

export interface DupeCandidate {
  kind: "same-name" | "overlap";
  names: string[];
  reason: string;
}

const OVERLAP_KEYS = [
  "review",
  "debug",
  "plan",
  "scaffold",
  "spec",
  "test",
  "write",
  "clean",
  "security",
  "architecture",
];

export function detectDupes(resources: HarnessResource[]): DupeCandidate[] {
  const out: DupeCandidate[] = [];

  // 同名（跨不同 id/来源）
  const byName = new Map<string, HarnessResource[]>();
  for (const r of resources) {
    if (r.status === "duplicate-of" || r.status === "superseded-by") continue;
    const arr = byName.get(r.name) ?? [];
    arr.push(r);
    byName.set(r.name, arr);
  }
  for (const [name, arr] of byName) {
    const distinctSources = new Set(arr.map((r) => `${r.source}:${r.scope}`));
    if (arr.length > 1 && distinctSources.size > 1) {
      out.push({
        kind: "same-name",
        names: arr.map((r) => `${r.name}@${r.source}:${r.scope}`),
        reason: `同名 \`${name}\` 出现于 ${arr.length} 处`,
      });
    }
  }

  // 功能重叠（跨来源 + 描述关键词）
  const active = resources.filter((r) => r.status === "active" || r.status === "candidate");
  for (const key of OVERLAP_KEYS) {
    const hits = active.filter((r) =>
      (r.description ?? "").toLowerCase().includes(key)
    );
    const distinct = new Set(hits.map((r) => r.source));
    if (hits.length > 1 && distinct.size > 1) {
      out.push({
        kind: "overlap",
        names: hits.map((r) => `${r.name}@${r.source}`),
        reason: `关键词 "${key}" 跨来源命中`,
      });
    }
  }

  return out;
}
