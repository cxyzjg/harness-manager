import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTurnViewFromPiFile } from "../src/monitor/turnView.js";
import { computeMetrics } from "../src/monitor/metrics.js";
import type { Session } from "../src/types.js";

function piFile(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "hm-turn-"));
  const f = join(dir, "s.jsonl");
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n"));
  return f;
}

const msg = (id: string, role: string, content: object[], ts = "2026-08-01T00:00:00Z") => ({
  type: "message", id, timestamp: ts, message: { role, content },
});

describe("buildTurnViewFromPiFile", () => {
  it("turn 边界: user 开新 turn, 思考/工具归属正确", () => {
    const f = piFile([
      msg("m1", "user", [{ type: "text", text: "帮我设计模块" }]),
      msg("m2", "assistant", [
        { type: "thinking", thinking: "先看现状" },
        { type: "toolCall", name: "read", id: "t1", arguments: { path: "a.ts" } },
      ]),
      msg("m3", "user", [{ type: "text", text: "继续" }]),
      msg("m4", "assistant", [{ type: "text", text: "好的" }]),
    ]);
    const tv = buildTurnViewFromPiFile(f, "s1")!;
    expect(tv.totalTurns).toBe(2);
    expect(tv.turns[0].tools).toHaveLength(1);
    expect(tv.turns[0].thinking).toHaveLength(1);
    expect(tv.turns[0].userInput).toContain("设计模块");
    expect(tv.turns[1].textOutput[0]).toContain("好的");
    // 上下文快照: turn2 开始时应含前一轮累计
    expect(tv.turns[1].contextAtTurn.messages).toBeGreaterThan(tv.turns[0].contextAtTurn.messages);
  });

  it("无 user 消息返回 null", () => {
    const f = piFile([msg("m1", "assistant", [{ type: "text", text: "hi" }])]);
    expect(buildTurnViewFromPiFile(f, "s1")).toBeNull();
  });
});

describe("computeMetrics", () => {
  it("计算量化指标与等级", () => {
    const f = piFile([
      msg("m1", "user", [{ type: "text", text: "go" }]),
      msg("m2", "assistant", [{ type: "toolCall", name: "bash", id: "t1", arguments: { command: "ls" } }]),
      msg("m3", "user", [{ type: "text", text: "ok" }]),
      msg("m4", "assistant", [{ type: "text", text: "done" }]),
    ]);
    const tv = buildTurnViewFromPiFile(f, "s1")!;
    const s: Session = { id: "s1", harness: "pi", cwd: "/p", messages: 4, tools: [] } as never;
    const m = computeMetrics(tv, s);
    expect(m.performance.turns).toBe(2);
    expect(m.performance.toolsPerTurn).toBe(0.5);
    expect(["A", "B", "C", "D"]).toContain(m.reliability.grade);
  });
});
