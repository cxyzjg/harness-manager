import { describe, it, expect } from "vitest";
import { pairSimilarity, semanticDedupe } from "../src/core/skills/semanticDedupe.js";
import { linkSkillEffects } from "../src/core/skills/effectLink.js";
import { skillInfo } from "../src/core/skills/skillDescriptions.js";

describe("语义去重", () => {
  it("正样本: tdd vs test-driven-development 命中", () => {
    const p = pairSimilarity(skillInfo("tdd")!, skillInfo("test-driven-development")!);
    expect(p).not.toBeNull();
    expect(p!.score).toBeGreaterThan(0.5);
  });

  it("负样本: tdd vs security 不报", () => {
    expect(pairSimilarity(skillInfo("tdd")!, skillInfo("security")!)).toBeNull();
  });

  it("全库去重有结果且按分数排序", () => {
    const all = semanticDedupe();
    expect(all.length).toBeGreaterThan(5);
    for (let i = 1; i < all.length; i++) expect(all[i - 1].score).toBeGreaterThanOrEqual(all[i].score);
    // 高置信的一定标记为重复
    const top = all[0];
    if (top.score >= 0.64) expect(top.verdict).toBe("semantic-duplicate");
  });
});

describe("触发效果关联", () => {
  it("无触发记录返回空", () => {
    expect(linkSkillEffects([{ id: "s1", harness: "pi", cwd: "/p" }], new Map())).toEqual([]);
  });
});
