/**
 * Agent 配置版本对比 (v2 阶段4新增: 同任务不同配置的效果差异可视化)
 *
 * 输出:
 *  - 字段差异: model / thinking_level / skills 增删 / tools 增删 / system_prompt 变化摘要
 *  - 成效对比: 各自关联会话的 平均成效分 / 平均token / 会话数
 */
import { getAgentConfig, sessionsOfConfig } from "../db/store.js";
import { getDb } from "../db/store.js";
import type { AgentConfig } from "../core/schema.js";

export interface ConfigDiff {
  a: { id: string; hash: string; model?: string; sessions: number; avgOutcome?: number; avgTokens?: number };
  b: { id: string; hash: string; model?: string; sessions: number; avgOutcome?: number; avgTokens?: number };
  fields: {
    modelChanged?: { from: string; to: string };
    skillsAdded: string[];
    skillsRemoved: string[];
    toolsAdded: string[];
    toolsRemoved: string[];
    promptChanged: boolean;
    promptSimilarity: number; // 0~1
  };
}

function avgOutcomeOf(sessionIds: string[], outcomeOf: Map<string, number>): { avg?: number; tokens?: number; count: number } {
  const scores: number[] = [];
  let tokens = 0;
  let tokN = 0;
  const d = getDb();
  for (const id of sessionIds) {
    const sc = outcomeOf.get(id);
    if (sc != null) scores.push(sc);
    const c = d.prepare("SELECT COALESCE(SUM(input_tokens+output_tokens),0) n FROM costs WHERE session_id=?").get(id) as { n: number };
    tokens += c.n;
    if (c.n > 0) tokN++;
  }
  return {
    avg: scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : undefined,
    tokens: tokN ? Math.round(tokens / tokN) : undefined,
    count: sessionIds.length,
  };
}

function setDiff(a?: string[], b?: string[]): { added: string[]; removed: string[] } {
  const A = new Set(a ?? []);
  const B = new Set(b ?? []);
  return {
    added: [...B].filter((x) => !A.has(x)),
    removed: [...A].filter((x) => !B.has(x)),
  };
}

function promptSim(a: string, b: string): number {
  if (a === b) return 1;
  const grams = (t: string): Set<string> => {
    const x = t.toLowerCase().replace(/\s+/g, "");
    const out = new Set<string>();
    for (let i = 0; i < x.length - 3; i++) out.add(x.slice(i, i + 4));
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return +( (2 * inter) / (A.size + B.size) ).toFixed(3);
}

export function compareConfigs(
  idA: string,
  idB: string,
  outcomeOf: Map<string, number>
): ConfigDiff | null {
  const ca = getAgentConfig(idA);
  const cb = getAgentConfig(idB);
  if (!ca || !cb) return null;

  const outA = avgOutcomeOf(sessionsOfConfig(idA), outcomeOf);
  const outB = avgOutcomeOf(sessionsOfConfig(idB), outcomeOf);

  const skillDiff = setDiff(ca.skills_loaded, cb.skills_loaded);
  const toolDiff = setDiff(ca.allowed_tools, cb.allowed_tools);
  const ps = promptSim(ca.system_prompt ?? "", cb.system_prompt ?? "");

  const wrap = (c: AgentConfig, o: ReturnType<typeof avgOutcomeOf>) => ({
    id: c.id,
    hash: c.version_hash,
    model: c.model,
    sessions: o.count,
    avgOutcome: o.avg,
    avgTokens: o.tokens,
  });

  return {
    a: wrap(ca, outA),
    b: wrap(cb, outB),
    fields: {
      modelChanged: ca.model !== cb.model ? { from: ca.model ?? "(无)", to: cb.model ?? "(无)" } : undefined,
      skillsAdded: skillDiff.added,
      skillsRemoved: skillDiff.removed,
      toolsAdded: toolDiff.added,
      toolsRemoved: toolDiff.removed,
      promptChanged: ps < 1,
      promptSimilarity: ps,
    },
  };
}
