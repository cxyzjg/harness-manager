import { describe, it, expect } from "vitest";
import { buildStory, renderStory } from "../src/core/sessions/story.js";
import type { Session } from "../src/types.js";

const mkSession = (over: Partial<Session>): Session => ({
  id: "s1",
  harness: "pi",
  cwd: "C:/proj",
  startedAt: "2026-08-01T00:00:00.000Z",
  messages: 5,
  tools: [],
  ...over,
});

describe("buildStory", () => {
  it("用 thinkings 批次对齐思考→工具", () => {
    const s = mkSession({
      tools: [
        { id: "t1", name: "read", input: { path: "a.ts" } } as never,
        { id: "t2", name: "bash", input: { command: "ls" } } as never,
      ],
      thinkings: [
        { content: "先看看项目结构", timestamp: "t0", followedByToolIds: ["t1", "t2"] },
      ],
    });
    const story = buildStory(s);
    expect(story).toHaveLength(1); // 1 思考节点(children 含 2 工具)
    expect(story[0].kind).toBe("thinking");
    expect(story[0].children).toHaveLength(2);
    expect(story[0].children![0].label).toBe("read");
  });

  it("无 thinkings 时用 toolCall.thinking 兜底", () => {
    const s = mkSession({
      tools: [
        { id: "t1", name: "read", thinking: "需要读文件" } as never,
      ],
    });
    const story = buildStory(s);
    expect(story[0].kind).toBe("thinking");
    expect(story[0].detail).toContain("读文件");
    expect(story[1].kind).toBe("tool");
  });

  it("标记错误工具调用", () => {
    const s = mkSession({
      tools: [
        { id: "t1", name: "bash", input: { command: "rm" }, output: "error: denied" } as never,
      ],
    });
    const story = buildStory(s);
    expect(story[0].toolError).toBe(true);
  });
});

describe("renderStory", () => {
  it("渲染思考 + 工具文本", () => {
    const s = mkSession({
      tools: [{ id: "t1", name: "read", input: { path: "a.ts" } } as never],
      thinkings: [{ content: "分析代码", followedByToolIds: ["t1"] }],
    });
    const text = renderStory(buildStory(s));
    expect(text).toContain("💭 思考");
    expect(text).toContain("分析代码");
    expect(text).toContain("read");
  });
});
