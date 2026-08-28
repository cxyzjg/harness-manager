import { describe, it, expect } from "vitest";
import {
  filterSessions,
  aggregateTokens,
  buildTimeline,
  contextStats,
  toolStats,
} from "../src/core/sessions/stats.js";
import type { Session } from "../src/types.js";

const mk = (over: Partial<Session>): Session => ({
  id: "s1",
  harness: "pi",
  cwd: "C:/proj/a",
  startedAt: "2026-08-01T00:00:00.000Z",
  messages: 10,
  tools: [],
  ...over,
});

describe("filterSessions", () => {
  const sessions = [
    mk({ id: "a", harness: "pi", cwd: "C:/proj/hb-ultra", tools: [{ id: "t1", name: "bash", input: { command: "npm test" } } as never] }),
    mk({ id: "b", harness: "claude", cwd: "C:/proj/other" }),
  ];
  it("按 harness 过滤", () => {
    expect(filterSessions(sessions, { harness: "claude" })).toHaveLength(1);
  });
  it("按项目过滤（不区分大小写）", () => {
    expect(filterSessions(sessions, { project: "hb-ultra" })).toHaveLength(1);
  });
  it("按工具入参关键词过滤", () => {
    expect(filterSessions(sessions, { query: "npm test" })).toHaveLength(1);
  });
  it("组合过滤", () => {
    expect(filterSessions(sessions, { harness: "pi", project: "other" })).toHaveLength(0);
  });
});

describe("aggregateTokens", () => {
  it("按项目/模型聚合 token", () => {
    const s = [
      mk({ id: "a", cwd: "C:/proj/x", model: "m1", tokenUsage: { input: 100, output: 20, total: 120 } }),
      mk({ id: "b", cwd: "C:/proj/x", model: "m1", tokenUsage: { input: 50, output: 10, total: 60 } }),
      mk({ id: "c", cwd: "C:/proj/y", model: "m2", tokenUsage: { input: 200, output: 40, total: 240 } }),
    ];
    const agg = aggregateTokens(s);
    expect(agg.totalInput).toBe(350);
    expect(agg.byProject["C:/proj/x"].sessions).toBe(2);
    expect(agg.byModel["m1"].input).toBe(150);
  });
  it("跳过无 token 会话", () => {
    const agg = aggregateTokens([mk({ id: "a", tokenUsage: undefined })]);
    expect(agg.total).toBe(0);
  });
});

describe("buildTimeline", () => {
  it("生成工具时间线条目", () => {
    const s = mk({
      tools: [
        { id: "1", name: "bash", input: { command: "ls" }, startedAt: "2026-08-01T00:00:01.000Z" } as never,
        { id: "2", name: "read", input: { path: "a.ts" }, startedAt: "2026-08-01T00:00:02.000Z" } as never,
      ],
    });
    const tl = buildTimeline(s);
    expect(tl).toHaveLength(2);
    expect(tl[0].toolName).toBe("bash");
    expect(tl[1].summary).toContain("a.ts");
  });
});

describe("contextStats", () => {
  it("统计消息数与大会话", () => {
    const s = [mk({ id: "a", messages: 100 }), mk({ id: "b", messages: 20 })];
    const cs = contextStats(s);
    expect(cs.totalMessages).toBe(120);
    expect(cs.largeSessions[0].id).toBe("a");
  });
});

describe("toolStats", () => {
  it("统计工具频率与 CC 慢调用", () => {
    const s = [
      mk({
        id: "a",
        tools: [
          { id: "1", name: "bash", durationMs: 5000 } as never,
          { id: "2", name: "bash" } as never,
          { id: "3", name: "read", durationMs: 500 } as never,
        ],
      }),
    ];
    const ts = toolStats(s);
    expect(ts.byName.bash).toBe(2);
    expect(ts.topTools[0].name).toBe("bash");
    // durationMs>1000 才进 slowest；但仅统计 CC 会话（pi 排除）
    expect(ts.slowestInCc).toHaveLength(0);
  });
});
