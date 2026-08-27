import { describe, it, expect } from "vitest";
import { piParse, piListSessions, piAvailable } from "../src/adapters/unified-pi.js";
import { ccParse, ccListSessions, ccAvailable } from "../src/adapters/unified-cc.js";
import { validateUnified } from "../src/core/schema.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("阶段1验收: pi -> 统一模型", () => {
  it("环境可用", () => {
    expect(piAvailable()).toBe(true);
    expect(piListSessions().length).toBeGreaterThan(0);
  });

  it("真实会话完整转换且信息不丢失", () => {
    const files = piListSessions();
    // 拿最大的真实会话验证
    const target = files[0];
    const r = piParse(target.path);
    expect(r.session).not.toBeNull();
    expect(r.session!.harness).toBe("pi");
    expect(r.session!.id.startsWith("pi:")).toBe(true);
    expect(r.session!.source_file).toBe(target.path);
    // turn 结构
    expect(r.turns.length).toBeGreaterThan(0);
    expect(r.turns[0].idx).toBeGreaterThanOrEqual(0);
    // 工具都归属到 turn
    for (const tc of r.tool_calls) {
      expect(tc.turn_id).toBeTruthy();
      expect(tc.name).toBeTruthy();
    }
    // 校验器零错误
    expect(validateUnified(r)).toEqual([]);
  });

  it("容错: 损坏行跳过并标 degraded", () => {
    const dir = mkdtempSync(join(tmpdir(), "hm-pi-"));
    const f = join(dir, "bad.jsonl");
    writeFileSync(f, [
      JSON.stringify({ type: "session", cwd: "C:\\p", timestamp: "2026-08-01T00:00:00Z" }),
      "not-valid-json {{{",
      JSON.stringify({ type: "message", id: "m1", timestamp: "2026-08-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
    ].join("\n"));
    const r = piParse(f);
    expect(r.session?.degraded).toBe(true);
    expect(r.errors.some((e) => e.line === 2)).toBe(true);
    expect(r.turns).toHaveLength(1); // 坏行不影响其余
  });
});

describe("阶段1验收: CC -> 统一模型", () => {
  it("环境可用", () => {
    expect(ccAvailable()).toBe(true);
    expect(ccListSessions().length).toBeGreaterThan(0);
  });

  it("真实会话转换 + 双harness同schema", () => {
    const files = ccListSessions();
    let validated = 0;
    for (const f of files.slice(0, 3)) {
      const r = ccParse(f.path);
      if (!r.session) continue;
      expect(r.session.harness).toBe("claude");
      expect(validateUnified(r)).toEqual([]);
      validated++;
    }
    expect(validated).toBeGreaterThan(0);
  });

  it("tool_result 关联 duration 和错误标记", () => {
    const dir = mkdtempSync(join(tmpdir(), "hm-cc-"));
    const f = join(dir, "s.jsonl");
    writeFileSync(f, [
      JSON.stringify({ type: "user", timestamp: "2026-08-06T06:46:50Z", message: { content: [{ type: "text", text: "go" }] } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-08-06T06:46:55Z", message: { model: "glm", content: [{ type: "tool_use", id: "c1", name: "Bash", input: { command: "x" } }] } }),
      JSON.stringify({ type: "tool_result", timestamp: "2026-08-06T06:46:57Z", tool_use_id: "c1", input: "error: denied" }),
    ].join("\n"));
    const r = ccParse(f);
    expect(r.session).not.toBeNull();
    expect(r.tool_calls).toHaveLength(1);
    expect(r.tool_calls[0].duration_ms).toBe(2000);
    expect(r.tool_calls[0].is_error).toBe(true);
  });
});
