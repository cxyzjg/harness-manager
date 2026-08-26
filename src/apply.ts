/**
 * M4 管理操作：启停/迁移/接线（dry-run → 确认 → 执行）
 * 语义与 scripts/apply.sh 一致：默认 dry-run，确认后才落盘。
 * 写操作范围（安全边界）:
 *   - enable/disable: 更新 docs/DECISIONS.md + 缓存中的资源状态（不删除任何文件）
 *   - move: 复制技能到单源目录 skills/（源目录保留，需确认后删除）
 * 绝不修改: trust.json / tool-gate.json / settings.json
 */
import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCache, saveCache } from "./storage.js";
import type { HarnessResource } from "./types.js";

/**
 * 仓库根：优先环境变量 HM_REPO_ROOT，否则用当前工作目录（要求从仓库根运行）。
 * tsx 下 import.meta.url 不可靠，故不依赖它。
 */
export const repoRoot = process.env.HM_REPO_ROOT ?? process.cwd();

export interface ApplyRequest {
  type: "enable" | "disable" | "move";
  resourceId?: string; // 资源 id（resources 列表里的 id）
  target?: string; // move 目标（单源 skills/ 下新名）
  reason?: string;
}

export interface ApplyPlan {
  type: string;
  resourceId?: string;
  actions: string[]; // 将执行的动作描述
}

export interface ApplyResult {
  planned: ApplyPlan[];
  executed?: boolean;
}

export function planMutation(req: ApplyRequest, repoRoot: string): ApplyPlan {
  const cache = loadCache();
  const res = cache?.resources.find((r) => r.id === req.resourceId);
  const actions: string[] = [];

  if (!res && req.resourceId) {
    actions.push(`⚠ 未找到资源 ${req.resourceId}（可能未扫描或已删除）`);
  }

  switch (req.type) {
    case "enable":
      actions.push(`将资源 "${res?.name ?? req.resourceId}" 标记为 active`);
      actions.push(`写入 docs/DECISIONS.md: active（${req.reason ?? ""}）`);
      actions.push("更新缓存中的资源状态为 active");
      break;
    case "disable":
      actions.push(`将资源 "${res?.name ?? req.resourceId}" 标记为 ${req.reason ?? "duplicate/superseded"}`);
      actions.push("写入 docs/DECISIONS.md（记录决策）");
      actions.push("更新缓存中的资源状态");
      actions.push("注意: 不删除任何文件，仅记录决策 + 标注状态");
      break;
    case "move":
      actions.push(`复制资源 "${res?.name ?? req.resourceId}" 到单源目录 skills/${req.target ?? res?.name ?? "?"}/`);
      actions.push("更新 docs/INDEX.md 归属为 single-source");
      actions.push("提示: 源目录保留，确认全部接线后手动删除");
      break;
  }
  return { type: req.type, resourceId: req.resourceId, actions };
}

export function executeMutation(req: ApplyRequest, repoRoot: string, confirmed: boolean): ApplyResult {
  const plan = planMutation(req, repoRoot);
  if (!confirmed) return { planned: [plan] };

  const decisionsPath = join(repoRoot, "docs", "DECISIONS.md");
  const date = new Date().toISOString().slice(0, 10);
  const res = loadCache()?.resources.find((r) => r.id === req.resourceId);
  const name = res?.name ?? req.resourceId ?? "?";

  switch (req.type) {
    case "enable":
      appendFileSync(decisionsPath, `\n- [${date}] \`${name}\` -> active（${req.reason ?? ""}）\n`);
      break;
    case "disable":
      appendFileSync(decisionsPath, `\n- [${date}] \`${name}\` -> ${req.reason ?? "duplicate/superseded"}（决策记录）\n`);
      break;
    case "move": {
      const src = res?.path;
      const targetDir = join(repoRoot, "skills", req.target ?? name);
      if (src && existsSync(src)) {
        if (existsSync(targetDir)) {
          // 目标已存在：不重复复制，仅记录（幂等）
          appendFileSync(decisionsPath, `\n- [${date}] \`${name}\` -> 目标 skills/${req.target ?? name}/ 已存在，标记已迁移（幂等）\n`);
        } else {
          mkdirSync(targetDir, { recursive: true });
          // 复制 SKILL.md（技能目录结构）
          if (existsSync(join(src, "SKILL.md"))) {
            cpSync(src, targetDir, { recursive: true });
          } else {
            cpSync(src, join(targetDir, "SKILL.md"));
          }
          appendFileSync(decisionsPath, `\n- [${date}] \`${name}\` -> 迁移到单源 skills/${req.target ?? name}/（源保留）\n`);
        }
      }
      break;
    }
  }

  // 更新缓存中的资源状态（enable/disable/move）
  const cache = loadCache();
  if (cache) {
    const target = cache.resources.find((r) => r.id === req.resourceId);
    if (target) {
      if (req.type === "enable") target.status = "active";
      if (req.type === "disable") target.status = req.reason?.includes("superseded") ? "superseded-by" : "duplicate-of";
      if (req.type === "move") {
        const dest = `skills/${req.target ?? name}/`;
        target.status = "migrated";
        target.migratedTo = dest;
        target.scope = "single-source";
        target.source = "single-source";
      }
    }
    saveCache(cache);
  }

  return { planned: [plan], executed: true };
}

// ========== 一键去重 ==========

/**
 * 一键去重：对一组重复资源，保留一个主用，其余标记为被取代。
 * @param resourceIds 该组所有资源 id（第一个为主用）
 * @param keepFirst   是否保留第一个为主用（否则需要手动指定 keepId）
 */
export function planDedupe(
  resourceIds: string[],
  keepId: string | undefined,
  repoRoot: string
): ApplyPlan[] {
  const cache = loadCache();
  const byId = new Map((cache?.resources ?? []).map((r) => [r.id, r]));
  const keep = keepId ?? resourceIds[0];
  const plans: ApplyPlan[] = [];

  for (const id of resourceIds) {
    const r = byId.get(id);
    if (!r) continue;
    if (id === keep) {
      plans.push({
        type: "dedupe-keep",
        resourceId: id,
        actions: [`保留 \`${r.name}\` (@${r.source}:${r.scope}) 为主用（active）`],
      });
    } else {
      plans.push({
        type: "dedupe-mark",
        resourceId: id,
        actions: [`将 \`${r.name}\` (@${r.source}:${r.scope}) 标记为 duplicate-of:${byId.get(keep)?.name ?? keep}（写入决策）`],
      });
    }
  }
  return plans;
}

/** 执行一键去重（确认后） */
export function executeDedupe(
  resourceIds: string[],
  keepId: string | undefined,
  repoRoot: string,
  confirmed: boolean
): { planned: ApplyPlan[]; executed?: boolean } {
  const plans = planDedupe(resourceIds, keepId, repoRoot);
  if (!confirmed) return { planned: plans };

  const decisionsPath = join(repoRoot, "docs", "DECISIONS.md");
  const date = new Date().toISOString().slice(0, 10);
  const cache = loadCache();
  const byId = new Map((cache?.resources ?? []).map((r) => [r.id, r]));
  const keep = keepId ?? resourceIds[0];
  const keepName = byId.get(keep)?.name ?? keep;

  for (const id of resourceIds) {
    const r = byId.get(id);
    if (!r) continue;
    if (id === keep) {
      appendFileSync(decisionsPath, `\n- [${date}] \`${r.name}\` (@${r.source}:${r.scope}) -> active（去重保留主用）\n`);
      if (cache) {
        const t = cache.resources.find((x) => x.id === id);
        if (t) t.status = "active";
      }
    } else {
      appendFileSync(decisionsPath, `\n- [${date}] \`${r.name}\` (@${r.source}:${r.scope}) -> duplicate-of:${keepName}（一键去重）\n`);
      if (cache) {
        const t = cache.resources.find((x) => x.id === id);
        if (t) { t.status = "duplicate-of"; t.duplicateOf = keepName; }
      }
    }
  }
  if (cache) saveCache(cache);
  return { planned: plans, executed: true };
}
