import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePiSession } from "../src/adapters/pi.js";
import { parseCcSession } from "../src/adapters/claude.js";
import { buildCallTree, renderTree, slowestCalls, toolFrequency } from "../src/core/sessions/calltree.js";
import { detectDupes } from "../src/core/skills/dedupe.js";
import type { HarnessResource } from "../src/types.js";

function tmpSession(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hm-test-"));
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

describe("parsePiSession", () => {
  it("解析消息 + 内嵌 toolCall 调用链", () => {
    const path = tmpSession("s.jsonl", [
      '{"type":"session","version":3,"id":"x","cwd":"C:\\\\proj","timestamp":"2026-08-14T02:45:00.000Z"}',
      '{"type":"message","id":"m1","parentId":"x","timestamp":"2026-08-14T02:45:10.000Z","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}',
      '{"type":"message","id":"m2","parentId":"m1","timestamp":"2026-08-14T02:45:15.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"tc1","name":"read","input":{"path":"a.ts"}}]}}',
      '{"type":"model_change","id":"x2","timestamp":"2026-08-14T02:45:16.000Z","modelId":"glm-5"}',
      '{"type":"usage","id":"u1","timestamp":"2026-08-14T02:45:16.000Z","input":120,"output":80}',
    ].join("\n"));
    const s = parsePiSession(path);
    expect(s).not.toBeNull();
    expect(s!.messages).toBe(2);
    expect(s!.tools).toHaveLength(1);
    expect(s!.tools[0].name).toBe("read");
    expect(s!.cwd).toContain("proj");
    expect(s!.tokenUsage).toEqual({ input: 120, output: 80, total: 200 });
  });

  it("空/损坏行：无消息且无工具时返回 null（不抛错）", () => {
    const path = tmpSession("bad.jsonl", '{"type":"session","cwd":"C:\\\\p"}\nnot-json\n');
    const s = parsePiSession(path);
    expect(s).toBeNull(); // 仅 session 事件、无消息无工具 → 空会话
  });
});

describe("parseCcSession", () => {
  it("解析 tool_use + tool_result 关联", () => {
    const path = tmpSession("c.jsonl", [
      '{"type":"user","timestamp":"2026-08-06T06:46:50.000Z","message":{"role":"user","model":"glm-5","usage":{"input_tokens":10,"output_tokens":5}}}',
      '{"type":"tool_use","timestamp":"2026-08-06T06:46:55.000Z","tool_use_id":"call_1","name":"Read","input":{"file_path":"a.ts"}}',
      '{"type":"tool_result","timestamp":"2026-08-06T06:46:56.000Z","tool_use_id":"call_1","input":"file content"}',
      '{"type":"assistant","timestamp":"2026-08-06T06:46:57.000Z","message":{"role":"assistant","model":"glm-5"}}',
    ].join("\n"));
    const s = parseCcSession(path, "C:/proj");
    expect(s).not.toBeNull();
    expect(s!.messages).toBe(2);
    expect(s!.tools).toHaveLength(1);
    expect(s!.tools[0].name).toBe("Read");
    expect(s!.tools[0].output).toBe("file content");
    expect(s!.tokenUsage?.total).toBe(15);
    expect(s!.cwd).toBe("C:/proj");
  });
});

describe("buildCallTree", () => {
  it("按 parentId 建树 + 文本渲染", () => {
    const tools = [
      { id: "a", name: "bash" },
      { id: "b", name: "read", parentId: "a" },
      { id: "c", name: "ls", parentId: "a" },
      { id: "d", name: "grep", parentId: "b" },
    ];
    const tree = buildCallTree(tools as never);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].children).toHaveLength(1);
    const text = renderTree(tree);
    expect(text).toContain("bash");
    expect(text).toContain("└─");
  });
});

describe("slowestCalls / toolFrequency", () => {
  it("返回最慢调用与频率", () => {
    const tools = [
      { id: "1", name: "bash", durationMs: 5000 },
      { id: "2", name: "bash", durationMs: 1000 },
      { id: "3", name: "read", durationMs: 200 },
    ];
    expect(slowestCalls(tools as never, 2)[0].durationMs).toBe(5000);
    expect(toolFrequency(tools as never)).toEqual({ bash: 2, read: 1 });
  });
});

describe("detectDupes", () => {
  const res = (name: string, source: string, scope: string, desc = ""): HarnessResource =>
    ({ id: `${source}:${scope}:${name}`, name, kind: "skill", source, scope, path: "/x", status: "active", harnesses: ["pi"], description: desc }) as never;

  it("检测同名跨来源", () => {
    const dupes = detectDupes([res("code-review", "pi", "global"), res("code-review", "claude", "project")]);
    expect(dupes.some((d) => d.kind === "same-name" && d.names.length === 2)).toBe(true);
  });

  it("忽略已标记 superseded 的资源", () => {
    const a = res("review", "pi", "global", "run review");
    const b = res("review", "package", "package", "code review");
    b.status = "superseded-by";
    const dupes = detectDupes([a, b]);
    expect(dupes.filter((d) => d.names.includes("review@package"))).toHaveLength(0);
  });

  it("检测功能重叠关键词", () => {
    const dupes = detectDupes([
      res("diagnosing-bugs", "pi", "global", "diagnosis loop, debugging, performance regressions"),
      res("systematic-debugging", "package", "package", "hypothesis-driven debugging, hypothesis"),
    ]);
    expect(dupes.some((d) => d.kind === "overlap" && d.reason.includes("debug"))).toBe(true);
  });
});
