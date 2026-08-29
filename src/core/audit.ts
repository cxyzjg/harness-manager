/**
 * 操作审计日志 (Q3: 治理闭环最后一块)
 *
 * 所有写操作(apply/toggle/onboard)自动追加 JSONL 审计:
 *   {ts, actor, action, target, before, after}
 * actor: CLI = "cli:<user>" / web = "web:<user>" — 本版无账户体系, 记录来源即可。
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../config.js";

const AUDIT_LOG = join(dataDir(), "audit.log");

export interface AuditEntry {
  ts: string;
  actor: string; // cli | web | extension
  action: string; // enable/disable/move/dedupe/toggle/onboard/prune
  target: string;
  before?: unknown;
  after?: unknown;
  detail?: string;
}

export function audit(entry: Omit<AuditEntry, "ts">): void {
  try {
    mkdirSync(dataDir(), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    appendFileSync(AUDIT_LOG, line + "\n");
  } catch {
    /* 审计失败不阻断业务 */
  }
}

/** 读取审计日志(最近N条, 最新在前) */
export function readAudit(limit = 50): AuditEntry[] {
  try {
    const lines = readFileSync(AUDIT_LOG, "utf-8").split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((x): x is AuditEntry => !!x)
      .reverse();
  } catch {
    return [];
  }
}
