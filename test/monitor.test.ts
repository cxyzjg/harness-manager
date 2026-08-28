import { describe, it, expect } from "vitest";
import { evaluateSession, evaluateAll } from "../src/core/sessions/sessionOutcome.js";
import { assessSkillHealth, healthSummary } from "../src/core/skills/skillHealth.js";
import type { Session, HarnessResource } from "../src/types.js";

const mkSession = (over: Partial<Session>): Session => ({
  id: "s1",
  harness: "pi",
  cwd: "C:/proj",
  startedAt: "2026-08-01T00:00:00.000Z",
  messages: 10,
  tools: [],
  ...over,
});

describe("evaluateSession", () => {
  it("写动作多 + 无错误 → 高分", () => {
    const s = mkSession({
      tools: [
        { id: "1", name: "read", input: { path: "a.ts" } } as never,
        { id: "2", name: "write", input: { path: "a.ts" } } as never,
        { id: "3", name: "edit", input: {} } as never,
        { id: "4", name: "write", input: { path: "b.ts" } } as never,
        { id: "5", name: "plan_mode_complete", input: {} } as never,
      ],
    });
    const o = evaluateSession(s);
    expect(o.score).toBeGreaterThanOrEqual(70);
    expect(o.level).toBe("high");
    expect(o.metrics.writeActions).toBe(3);
  });

  it("纯读取无写入 → 中低分 + 复盘建议", () => {
    const s = mkSession({
      tools: [
        { id: "1", name: "read", input: {} } as never,
        { id: "2", name: "ls", input: {} } as never,
      ],
    });
    const o = evaluateSession(s);
    expect(o.score).toBeLessThan(70);
    expect(o.metrics.writeActions).toBe(0);
    expect(o.suggestions.some((x) => x.includes("复盘"))).toBe(true); // 短纯读会话触发复盘建议
  });

  it("大量错误 → 低分", () => {
    const s = mkSession({
      tools: Array.from({ length: 6 }, (_, i) => ({
        id: `e${i}`,
        name: "bash",
        input: { command: "rm" },
        output: "error: permission denied",
      })) as never,
    });
    const o = evaluateSession(s);
    expect(o.level).toBe("low");
    expect(o.metrics.errors).toBe(6);
  });

  it("重试检测", () => {
    const s = mkSession({
      tools: [
        { id: "1", name: "bash", input: { command: "ls" } } as never,
        { id: "2", name: "bash", input: { command: "ls" } } as never,
        { id: "3", name: "read", input: { path: "x" } } as never,
      ],
    });
    const o = evaluateSession(s);
    expect(o.metrics.retries).toBe(1);
  });
});

describe("assessSkillHealth", () => {
  const res = (name: string, source: string, scope: string, status = "active", desc = "A skill with a reasonably long description that explains what it does"): HarnessResource =>
    ({ id: `${source}:${scope}:${name}`, name, kind: "skill", source, scope, path: "/x", status, harnesses: ["pi"], description: desc }) as never;

  it("active + 有描述 → 健康", () => {
    const h = assessSkillHealth([res("good", "pi", "global")]);
    expect(h[0].level).toBe("healthy");
  });

  it("同名冲突 → 需关注", () => {
    const h = assessSkillHealth([
      res("code-review", "pi", "global"),
      res("code-review", "claude", "project"),
    ]);
    const cr = h.find((x) => x.resource.name === "code-review");
    expect(cr!.issues.some((i) => i.includes("同名"))).toBe(true);
  });

  it("缺描述 → 扣分并建议补充", () => {
    const h = assessSkillHealth([res("no-desc", "pi", "global", "active", "")]);
    expect(h[0].score).toBeLessThan(70);
    expect(h[0].actions.some((a) => a.includes("description"))).toBe(true);
  });

  it("healthSummary 统计", () => {
    const h = assessSkillHealth([
      res("a", "pi", "global"),
      res("b", "pi", "global", "active", ""),
    ]);
    const sum = healthSummary(h);
    expect(sum.total).toBe(2);
    expect(sum.byLevel.healthy).toBeGreaterThanOrEqual(1);
  });
});
