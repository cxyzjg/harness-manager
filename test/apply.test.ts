import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planMutation, executeMutation } from "../src/apply.js";
import { saveCache } from "../src/storage.js";
import { dataDir } from "../src/config.js";

// 测试用临时仓库根（避免污染真实 DECISIONS.md / 缓存）
let repoRoot: string;
let realCacheBackup = "";

beforeAll(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "hm-apply-"));
  mkdirSync(join(repoRoot, "docs"), { recursive: true });
  writeFileSync(join(repoRoot, "docs", "DECISIONS.md"), "# DECISIONS\n");
  mkdirSync(join(repoRoot, "skills"), { recursive: true });
  // 造一个假技能目录
  mkdirSync(join(repoRoot, "skills", "probe-skill"), { recursive: true });
  writeFileSync(join(repoRoot, "skills", "probe-skill", "SKILL.md"), "---\nname: probe-skill\n---\n");
  // 备份真实缓存，测试后恢复
  const cpath = join(dataDir(), "cache.json");
  if (existsSync(cpath)) {
    realCacheBackup = cpath + ".test-bak";
    copyFileSync(cpath, realCacheBackup);
  }
  // 造缓存（指向临时技能）
  saveCache({
    resources: [
      {
        id: "pi:global:probe-skill",
        name: "probe-skill",
        kind: "skill",
        source: "pi",
        scope: "global",
        path: join(repoRoot, "skills", "probe-skill"),
        status: "active",
        harnesses: ["pi"],
      } as never,
    ],
    sessions: [],
    memories: [],
    errors: [],
  });
});

afterAll(() => {
  // 恢复真实缓存
  try {
    const cpath = join(dataDir(), "cache.json");
    rmSync(cpath, { force: true });
    if (realCacheBackup) copyFileSync(realCacheBackup, cpath);
  } catch { /* ignore */ }
});

describe("planMutation", () => {
  it("disable 生成计划动作（不落盘）", () => {
    const plan = planMutation({ type: "disable", resourceId: "pi:global:probe-skill", reason: "duplicate-of:x" }, repoRoot);
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions.join(" ")).toContain("标记为 duplicate-of:x");
  });

  it("找不到资源时给出警告", () => {
    const plan = planMutation({ type: "disable", resourceId: "nonexistent" }, repoRoot);
    expect(plan.actions.join(" ")).toContain("未找到");
  });
});

describe("executeMutation", () => {
  it("未确认时不执行（仅返回计划）", () => {
    const before = readFileSync(join(repoRoot, "docs", "DECISIONS.md"), "utf-8");
    const r = executeMutation({ type: "disable", resourceId: "pi:global:probe-skill" }, repoRoot, false);
    expect(r.executed).toBeUndefined();
    expect(readFileSync(join(repoRoot, "docs", "DECISIONS.md"), "utf-8")).toBe(before);
  });

  it("确认后写入 DECISIONS.md 并更新缓存状态", () => {
    const r = executeMutation(
      { type: "disable", resourceId: "pi:global:probe-skill", reason: "duplicate-of:other" },
      repoRoot,
      true
    );
    expect(r.executed).toBe(true);
    const content = readFileSync(join(repoRoot, "docs", "DECISIONS.md"), "utf-8");
    expect(content).toContain("probe-skill");
  });
});
