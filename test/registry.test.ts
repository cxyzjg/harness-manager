import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillHash, resolveConflict } from "../src/monitor/registry.js";
import { loadRegistry, saveRegistry } from "../src/monitor/registry.js";

let repoRoot: string;

beforeAll(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "hm-reg-"));
});

afterAll(() => {
  try { rmSync(repoRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("skillHash", () => {
  it("相同内容 hash 一致", () => {
    const d1 = join(repoRoot, "s1");
    const d2 = join(repoRoot, "s2");
    mkdirSync(d1, { recursive: true });
    mkdirSync(d2, { recursive: true });
    writeFileSync(join(d1, "SKILL.md"), "---\nname: x\n---\ncontent");
    writeFileSync(join(d2, "SKILL.md"), "---\nname: x\n---\ncontent");
    expect(skillHash(d1)).toBe(skillHash(d2));
  });

  it("不同内容 hash 不同", () => {
    const d1 = join(repoRoot, "s3");
    const d2 = join(repoRoot, "s4");
    mkdirSync(d1, { recursive: true });
    mkdirSync(d2, { recursive: true });
    writeFileSync(join(d1, "SKILL.md"), "content A");
    writeFileSync(join(d2, "SKILL.md"), "content B");
    expect(skillHash(d1)).not.toBe(skillHash(d2));
  });
});

describe("resolveConflict", () => {
  it("设置冲突处理动作", () => {
    const reg = loadRegistry();
    reg.skills["probe"] = {
      name: "probe",
      sources: [
        { kind: "global", path: "/a", versionHash: "h1", updatedAt: "" },
        { kind: "package", path: "/b", versionHash: "h2", updatedAt: "" },
      ],
      state: "active",
      category: "系统工具",
      conflict: { exists: true },
    };
    saveRegistry(reg);
    const r = resolveConflict(reg, "probe", "keep");
    expect(r.skills["probe"].conflict?.action).toBe("keep");
    const r2 = resolveConflict(r, "probe", "update", "/b");
    expect(r2.skills["probe"].conflict?.chosenPath).toBe("/b");
  });
});
