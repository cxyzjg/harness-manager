import { describe, it, expect } from "vitest";
import { classifyTool, extractTouchedFiles } from "../src/db/summary.js";

describe("classifyTool", () => {
  it("按工具名分类动作", () => {
    expect(classifyTool("edit")).toBe("write");
    expect(classifyTool("read")).toBe("read");
    expect(classifyTool("bash")).toBe("exec");
    expect(classifyTool("grep")).toBe("search");
  });
});

describe("extractTouchedFiles", () => {
  it("从 JSON 字符串入参提取 path", () => {
    const calls = [
      { name: "edit", input: JSON.stringify({ path: "src/a.ts", edits: [{ newText: "x" }] }) },
      { name: "write", input: JSON.stringify({ path: "docs/b.md" }) },
      { name: "read", input: JSON.stringify({ path: "ignored.ts" }) }, // 非写工具
      { name: "edit", input: "not-json" }, // 解析失败应跳过
    ];
    const files = extractTouchedFiles(calls);
    expect(files).toContain("src/a.ts");
    expect(files).toContain("docs/b.md");
    expect(files).not.toContain("ignored.ts");
    expect(files).not.toContain("not-json");
  });
});
