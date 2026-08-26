import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planMutation, executeMutation, planDedupe, executeDedupe } from "../src/apply.js";
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
  // 造一个假技能目录（源放在 tmpdir 下独立位置，模拟 ~/.agents/skills）
  const srcSkill = mkdtempSync(join(tmpdir(), "hm-src-"));
  mkdirSync(join(srcSkill, "probe-skill"), { recursive: true });
  writeFileSync(join(srcSkill, "probe-skill", "SKILL.md"), "---\nname: probe-skill\n---\n");
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
        path: join(srcSkill, "probe-skill"),
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

  it("move 后标记 migrated + scope=single-source + migratedTo", () => {
    const r = executeMutation(
      { type: "move", resourceId: "pi:global:probe-skill" },
      repoRoot,
      true
    );
    expect(r.executed).toBe(true);
    // 重新加载缓存验证状态
    const c = JSON.parse(readFileSync(join(dataDir(), "cache.json"), "utf-8"));
    const t = c.resources.find((x) => x.id === "pi:global:probe-skill");
    expect(t.status).toBe("migrated");
    expect(t.scope).toBe("single-source");
    expect(t.source).toBe("single-source");
    expect(t.migratedTo).toContain("skills/probe-skill");
  });
});

describe("executeDedupe", () => {
  it("一键去重：保留主用 + 标记其余 + 写决策", () => {
    // 造两个资源
    const ids = ["pi:global:probe-skill", "pi:global:probe-skill-2"];
    // 先塞入第二个资源到缓存
    const c = JSON.parse(readFileSync(join(dataDir(), "cache.json"), "utf-8"));
    c.resources.push({
      id: "pi:global:probe-skill-2", name: "probe-skill-2", kind: "skill", source: "pi", scope: "global",
      path: "/x", status: "active", harnesses: ["pi"],
    });
    writeFileSync(join(dataDir(), "cache.json"), JSON.stringify(c));

    // dry-run
    const plan = planDedupe(ids, ids[0], repoRoot);
    expect(plan.length).toBe(2);
    expect(plan[0].actions[0]).toContain("保留");
    expect(plan[1].actions[0]).toContain("duplicate-of");

    // 执行
    const r = executeDedupe(ids, ids[0], repoRoot, true);
    expect(r.executed).toBe(true);
    const content = readFileSync(join(repoRoot, "docs", "DECISIONS.md"), "utf-8");
    expect(content).toContain("probe-skill-2");
    expect(content).toContain("duplicate-of:probe-skill");
  });
});
