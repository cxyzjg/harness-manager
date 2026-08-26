/**
 * 会话中心（第3项：实时 + 会话 + 成效 融合）
 *
 * 一个模块聚合:
 *  - 实时(live): 正在发生的调用
 *  - 会话列表 + 详情
 *  - 成效评估(outcome)
 *  - 执行轨迹+思考(story)
 *
 * Web "会话中心" 页 = 一个视图看全。
 */
import type { Session } from "../types.js";
import { liveSnapshot } from "./realtime.js";
import { evaluateAll, type SessionOutcome } from "./sessionOutcome.js";
import { buildStory, type StoryNode } from "../analysis/story.js";

export interface SessionHubData {
  live: ReturnType<typeof liveSnapshot>;
  summary: {
    totalSessions: number;
    totalTools: number;
    totalTokens: number;
    highOutcome: number;
    mediumOutcome: number;
    lowOutcome: number;
  };
  sessions: (Session & { outcome?: SessionOutcome; storyCount?: number })[];
  recentOutcomes: SessionOutcome[];
}

/** 构建会话中心数据 */
export function buildSessionHub(sessions: Session[]): SessionHubData {
  const live = liveSnapshot();
  const outcomes = evaluateAll(sessions);
  const byId = new Map(outcomes.map((o) => [o.sessionId, o]));

  const summary = {
    totalSessions: sessions.length,
    totalTools: sessions.reduce((a, s) => a + s.tools.length, 0),
    totalTokens: sessions.reduce((a, s) => a + (s.tokenUsage?.total ?? 0), 0),
    highOutcome: outcomes.filter((o) => o.level === "high").length,
    mediumOutcome: outcomes.filter((o) => o.level === "medium").length,
    lowOutcome: outcomes.filter((o) => o.level === "low").length,
  };

  const enriched = sessions.map((s) => {
    const outcome = byId.get(s.id);
    return { ...s, outcome, storyCount: s.thinkings?.length ?? s.tools.filter((t) => t.thinking).length };
  });

  return {
    live,
    summary,
    sessions: enriched.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")),
    recentOutcomes: outcomes.slice(0, 10),
  };
}

/** 会话详情（含轨迹 + 成效） */
export function sessionDetail(id: string, sessions: Session[]) {
  const s = sessions.find((x) => x.id.startsWith(id));
  if (!s) return null;
  const outcome = evaluateAll([s])[0];
  const story = buildStory(s);
  return { ...s, outcome, story };
}

export type { StoryNode };
