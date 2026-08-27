/**
 * 导入编排: 跑全部可用 adapter -> 校验 -> 幂等入库
 * 阶段1验收: 双 harness(pi+CC) 会话进入同一 schema
 */
import { piAvailable, piListSessions, piParse } from "../adapters/unified-pi.js";
import { ccAvailable, ccListSessions, ccParse } from "../adapters/unified-cc.js";
import { ingest, globalStats } from "../db/store.js";
import type { IngestResult } from "../core/schema.js";

export interface IngestReport {
  harnesses: string[];
  ingested: number;
  failed: number;
  totalErrors: number;
  degraded: number;
  stats: ReturnType<typeof globalStats>;
}

export function runIngest(opts: { only?: ("pi" | "claude")[] } = {}): IngestReport {
  const harnesses: string[] = [];
  let ingested = 0;
  let failed = 0;
  let totalErrors = 0;
  let degraded = 0;

  const runOne = (id: "pi" | "claude", avail: () => boolean, list: () => { fileId: string; path: string }[], parse: (f: string) => IngestResult) => {
    if (opts.only && !opts.only.includes(id)) return;
    if (!avail()) return;
    harnesses.push(id);
    for (const f of list()) {
      try {
        const res = parse(f.path);
        const r = ingest(res);
        if (r.ok) {
          ingested++;
          if (res.session?.degraded) degraded++;
        } else failed++;
        totalErrors += r.errorCount;
      } catch (e) {
        // D2: 单文件失败不阻断其他
        failed++;
        totalErrors++;
      }
    }
  };

  runOne("pi", piAvailable, piListSessions, piParse);
  runOne("claude", ccAvailable, ccListSessions, ccParse);

  return { harnesses, ingested, failed, totalErrors, degraded, stats: globalStats() };
}
