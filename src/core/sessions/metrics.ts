/**
 * P2: 性能 + 可靠性量化指标
 *
 * 从 turn 视图 + 会话数据计算量化指标:
 *  性能: token效率(有效turn/token) / 工具密度 / 思考深度 / 上下文增长 / 压缩次数
 *  可靠性: 错误率 / 重试率 / 空转率(无产出turn) / 可靠性等级
 */
import type { TurnView } from "./turnView.js";
import type { Session } from "../../types.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface SessionMetrics {
  sessionId: string;
  harness: string;
  // 性能
  performance: {
    turns: number;
    toolsPerTurn: number; // 平均每 turn 工具数
    thinkingPerTurn: number; // 平均每 turn 思考段
    tokensTotal: number;
    tokensPerTurn: number;
    contextGrowth: number; // 末turn上下文消息数 - 首
    compactions: number; // 压缩次数
    toolDiversity: number; // 使用的不同工具数
  };
  // 可靠性
  reliability: {
    errorRate: number; // 出错调用/总调用
    retryRate: number; // 重试模式/总调用
    emptyTurnRate: number; // 无产出(无工具无文本)turn 占比
    errorCalls: number;
    totalCalls: number;
    grade: "A" | "B" | "C" | "D"; // 可靠性等级
    signals: string[]; // 判断依据
  };
}

export function computeMetrics(tv: TurnView, session: Session): SessionMetrics {
  const turns = tv.turns;
  const n = Math.max(1, turns.length);
  const totalTools = tv.totals.tools;
  const totalThinking = tv.totals.thinking;

  // 性能
  const tokensTotal = session.tokenUsage?.total ?? 0;
  const contextGrowth =
    turns.length > 1 ? turns[turns.length - 1].contextAtTurn.messages - turns[0].contextAtTurn.messages : 0;
  const toolNames = new Set<string>();
  for (const t of turns) for (const tc of t.tools) toolNames.add(tc.name);

  // 可靠性: 错误/重试从 session.tools(有 output/error 字段)统计
  const calls = session.tools ?? [];
  const errorCalls = calls.filter(
    (c) => c.error || /error|failed|denied/i.test(String(c.output ?? "").slice(0, 200))
  ).length;
  let retries = 0;
  for (let i = 1; i < calls.length; i++) {
    const a = JSON.stringify(calls[i - 1].input ?? "");
    const b = JSON.stringify(calls[i].input ?? "");
    if (calls[i - 1].name === calls[i].name && a === b) retries++;
  }
  const emptyTurns = turns.filter((t) => t.tools.length === 0 && t.textOutput.length === 0 && t.thinking.length === 0).length;
  const errorRate = calls.length ? errorCalls / calls.length : 0;
  const retryRate = calls.length ? retries / calls.length : 0;
  const emptyTurnRate = emptyTurns / n;

  // 等级
  const score = 100 - errorRate * 400 - retryRate * 200 - emptyTurnRate * 100;
  const grade = score >= 85 ? "A" : score >= 65 ? "B" : score >= 40 ? "C" : "D";

  const signals: string[] = [];
  if (errorRate > 0.05) signals.push(`错误率 ${(errorRate * 100).toFixed(1)}% 偏高`);
  if (retryRate > 0.05) signals.push(`重试率 ${(retryRate * 100).toFixed(1)}% 偏高`);
  if (emptyTurnRate > 0.3) signals.push(`${emptyTurns} 个空转 turn`);
  if (!signals.length) signals.push("错误/重试/空转均正常");

  return {
    sessionId: session.id,
    harness: session.harness,
    performance: {
      turns: turns.length,
      toolsPerTurn: +(totalTools / n).toFixed(1),
      thinkingPerTurn: +(totalThinking / n).toFixed(1),
      tokensTotal,
      tokensPerTurn: Math.round(tokensTotal / n),
      contextGrowth,
      compactions: countCompactions(session),
      toolDiversity: toolNames.size,
    },
    reliability: {
      errorRate: +errorRate.toFixed(3),
      retryRate: +retryRate.toFixed(3),
      emptyTurnRate: +emptyTurnRate.toFixed(3),
      errorCalls,
      totalCalls: calls.length,
      grade,
      signals,
    },
  };
}

function countCompactions(session: Session): number {
  // 从 pi 会话文件统计 compaction 条目数
  if (session.harness !== "pi") return 0;
  try {
    const root = join(homedir(), ".pi", "agent", "sessions");
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(dir)) {
        const f = join(dir, e);
        if (statSync(f).isDirectory()) out.push(...walk(f));
        else if (e.endsWith(".jsonl") && e.includes(session.id.slice(0, 20))) out.push(f);
      }
      return out;
    };
    for (const f of walk(root)) {
      const content = readFileSync(f, "utf-8");
      const m = content.match(/"type":"compaction"/g);
      return m ? m.length : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}
