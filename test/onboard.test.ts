import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  singleSourceNames,
  detectNewSkills,
  saveBaseline,
  loadBaseline,
} from "../src/monitor/onboard.js";
import { dataDir } from "../src/config.js";
import type { HarnessResource } from "../src/types.js";

let repoRoot: string;
let realCacheBackup = "";

beforeAll(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "hm-onboard-"));
  mkdirSync(join(repoRoot, "skills"), { recursive: true });
  // 单源里已有 manage-skills
  mkdirSync(join(repoRoot, "skills", "manage-skills"), { recursive: true });
  writeFileSync(join(repoRoot, "skills", "manage-skills", "SKILL.md"), "---\nname: manage-skills\n---\n");
  // 备份真实缓存
  const cpath = join(dataDir(), "cache.json");
  if (existsSync(cpath)) {
    realCacheBackup = cpath + ".onboard-bak";
    copyFileSync(cpath, realCacheBackup);
  }
  // 不覆盖全局缓存（detectNewSkills 直接用传入资源，不依赖缓存）
  saveBaseline(new Set(["manage-skills"]));
});

afterAll(() => {
  try {
    const cpath = join(dataDir(), "cache.json");
    rmSync(cpath, { force: true });
    if (realCacheBackup) copyFileSync(realCacheBackup, cpath);
    rmSync(join(dataDir(), "skill-baseline.json"), { force: true });
  } catch { /* ignore */ }
});

const res = (name: string, source: string, scope: string, path = "/x"): HarnessResource =>
  ({ id: `${source}:${scope}:${name}`, name, kind: "skill", source, scope, path, status: "active", harnesses: ["pi"] }) as never;

describe("singleSourceNames", () => {
  it("读取单源目录技能名", () => {
    expect(singleSourceNames(repoRoot).has("manage-skills")).toBe(true);
  });
});

describe("detectNewSkills", () => {
  it("基线外 + 非单源 → 新技能候选", () => {
    const cands = detectNewSkills(
      [
        res("manage-skills", "pi", "global"),
        res("new-skill", "pi", "global", "/x/new-skill"),
        res("pkg-skill", "package", "package"),
        res("proj-skill", "claude", "project"),
      ],
      repoRoot
    );
    const names = cands.map((c) => c.name);
    expect(names).toContain("new-skill");
    expect(names).not.toContain("manage-skills"); // 已在单源
    expect(names).not.toContain("pkg-skill"); // 非 pi global
    expect(names).not.toContain("proj-skill"); // 项目级
  });
});

describe("saveBaseline/loadBaseline", () => {
  it("保存后可读回", () => {
    saveBaseline(new Set(["a", "b", "manage-skills"]));
    const b = loadBaseline();
    expect(b.names).toContain("a");
    expect(b.updatedAt).toBeTruthy();
  });
});
