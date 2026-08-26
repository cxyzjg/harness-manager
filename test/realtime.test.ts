import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readLiveEvents, liveSnapshot } from "../src/monitor/realtime.js";

const LOG_DIR = join(homedir(), ".harness-manager", "realtime");
const LOG_FILE = join(LOG_DIR, "events.log");

beforeAll(() => {
  mkdirSync(LOG_DIR, { recursive: true });
  const now = Date.now();
  const lines = [
    JSON.stringify({ ts: new Date(now - 5 * 60_000).toISOString(), type: "session_start", sessionId: "s1", cwd: "/proj" }),
    JSON.stringify({ ts: new Date(now - 4 * 60_000).toISOString(), type: "tool_call", toolName: "read", input: { path: "a.ts" }, sessionId: "s1" }),
    JSON.stringify({ ts: new Date(now - 3 * 60_000).toISOString(), type: "tool_call", toolName: "bash", input: { command: "ls" }, sessionId: "s1" }),
    JSON.stringify({ ts: new Date(now - 2 * 60_000).toISOString(), type: "tool_call", toolName: "bash", input: { command: "npm test" }, sessionId: "s1" }),
  ];
  writeFileSync(LOG_FILE, lines.join("\n") + "\n");
});

afterAll(() => {
  try { rmSync(LOG_FILE, { force: true }); } catch { /* ignore */ }
});

describe("readLiveEvents", () => {
  it("读取事件日志", () => {
    const ev = readLiveEvents();
    expect(ev.length).toBeGreaterThanOrEqual(4);
    expect(ev.some((e) => e.type === "tool_call" && e.toolName === "bash")).toBe(true);
  });
});

describe("liveSnapshot", () => {
  it("统计最近1h工具调用 + 活跃会话", () => {
    const snap = liveSnapshot();
    expect(snap.active).toBe(true);
    expect(snap.window1h.toolCalls).toBeGreaterThanOrEqual(3);
    expect(snap.window1h.byTool.bash).toBeGreaterThanOrEqual(2);
    expect(snap.activeSessions).toContain("s1");
    expect(snap.recent.length).toBeGreaterThanOrEqual(4);
  });

  it("最近事件最新在前", () => {
    const snap = liveSnapshot();
    const t0 = new Date(snap.recent[0].ts).getTime();
    const t1 = new Date(snap.recent[1].ts).getTime();
    expect(t0).toBeGreaterThanOrEqual(t1);
  });
});
