import { describe, it, expect } from "vitest";
import { diffFleet } from "../src/fleet.js";
import type { ScanResult } from "../src/types.js";

const res = (source: string, name: string) => ({
  id: `${source}:${name}`,
  name,
  kind: "skill",
  source,
  scope: "global",
  path: "/x",
  status: "active",
  harnesses: ["pi"],
});

describe("diffFleet", () => {
  it("对比两机资源差异", () => {
    const a: ScanResult = {
      resources: [res("pi", "code-review") as never, res("pi", "tdd") as never, res("package", "review") as never],
      sessions: [{ id: "a", harness: "pi", cwd: "/p", messages: 10, tools: [] } as never],
      memories: [],
      errors: [],
    };
    const b: ScanResult = {
      resources: [res("pi", "code-review") as never, res("claude", "cost") as never],
      sessions: [{ id: "b", harness: "pi", cwd: "/p", messages: 20, tools: [] } as never],
      memories: [],
      errors: [],
    };
    const d = diffFleet(a, b);
    expect(d.common).toBe(1); // code-review 共有
    expect(d.onlyA).toEqual(["pi:tdd", "package:review"]);
    expect(d.onlyB).toEqual(["claude:cost"]);
    expect(d.sessionDiff).toBe(0); // 两机各 1 会话
  });

  it("处理 undefined 主机", () => {
    const d = diffFleet(undefined, undefined);
    expect(d.common).toBe(0);
    expect(d.onlyA).toEqual([]);
  });
});
