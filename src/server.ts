/**
 * M3 Web 控制面：本地 HTTP 服务（零依赖，Node 内置 http）
 * API:
 *   GET /api/dashboard   — 总览（资源/会话/token/去重统计）
 *   GET /api/resources   — 资源列表
 *   GET /api/sessions    — 会话列表
 *   GET /api/sessions/<id> — 会话详情（含调用链树）
 *   GET /api/dedupe      — 去重候选
 *   GET /api/trend       — token 趋势
 *   GET /api/stats       — 上下文规模 + 工具统计
 *   GET /api/memories    — 记忆文件
 *   GET /                — 单页可视化
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, ensureDataDir } from "./config.js";
import { scan } from "./orchestrator.js";
import { loadCache, saveCache } from "./storage.js";
import { detectDupes } from "./analysis/dedupe.js";
import { aggregateTokens, contextStats, toolStats } from "./analysis/stats.js";
import { buildCallTree } from "./analysis/calltree.js";
import { planMutation, executeMutation, executeDedupe, repoRoot, type ApplyRequest } from "./apply.js";
import * as skillCategories from "./analysis/skillCategories.js";
import { evaluateAll } from "./monitor/sessionOutcome.js";
import { assessSkillHealth, healthSummary } from "./monitor/skillHealth.js";

const htmlPath = join(repoRoot, "src", "web", "index.html");

let cached = loadCache();

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function ensureData(): Promise<void> {
  if (!cached) {
    cached = await scan();
    saveCache(cached);
  }
}

function dashboard() {
  if (!cached) return { resources: 0, sessions: 0, memories: 0, tokens: 0, dupes: [] };
  const tokens = aggregateTokens(cached.sessions);
  const dupes = detectDupes(cached.resources);
  const cs = contextStats(cached.sessions);
  return {
    resources: cached.resources.length,
    sessions: cached.sessions.length,
    memories: cached.memories.length,
    bySource: countBy(cached.resources, (r) => r.source),
    tokens: tokens.total,
    totalMessages: cs.totalMessages,
    dupes: dupes.length,
    dupeGroups: dupes.slice(0, 10).map((d) => d.reason),
  };
}

function countBy<T>(arr: T[], key: (x: T) => string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of arr) m[key(x)] = (m[key(x)] ?? 0) + 1;
  return m;
}

function sessionDetail(id: string) {
  if (!cached) return null;
  const s = cached.sessions.find((x) => x.id.startsWith(id));
  if (!s) return null;
  return { ...s, tree: buildCallTree(s.tools) };
}

const routes: Record<string, (url: URL) => Promise<unknown> | unknown> = {
  "/api/dashboard": () => dashboard(),
  "/api/resources": () =>
    (cached?.resources ?? []).map((r) => {
      if (r.kind === "skill" || r.kind === "project-skill") {
        const { categoryOf, CATEGORY_ICON } = skillCategories;
        const cat = categoryOf(r.name);
        return { ...r, category: cat, categoryIcon: CATEGORY_ICON[cat] };
      }
      return r;
    }),
  "/api/sessions": () => cached?.sessions ?? [],
  "/api/dedupe": () => (cached ? detectDupes(cached.resources) : []),
  "/api/trend": () => (cached ? aggregateTokens(cached.sessions) : {}),
  "/api/stats": () =>
    cached
      ? { cs: contextStats(cached.sessions), ts: toolStats(cached.sessions) }
      : {},
  "/api/memories": () => cached?.memories ?? [],
  "/api/live": () => import("./monitor/realtime.js").then(({ liveSnapshot }) => liveSnapshot()),
  "/api/outcome": () => (cached ? evaluateAll(cached.sessions) : []),
  "/api/health": () =>
    cached
      ? (() => {
          const health = assessSkillHealth(cached.resources);
          return { health, summary: healthSummary(health) };
        })()
      : { health: [], summary: null },
};

export function startServer(): void {
  const cfg = loadConfig();
  ensureDataDir();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      // POST /api/onboard — 新技能迁移（检测 + 执行）
      if (path === "/api/onboard" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body) as { names?: string[]; confirm?: boolean };
        const { detectNewSkills, migrateNewSkills, saveBaseline, singleSourceNames } = await import("./monitor/onboard.js");
        const candidates = detectNewSkills(cached?.resources ?? [], repoRoot);
        if (payload.confirm === true) {
          const toMigrate = payload.names
            ? candidates.filter((c) => payload.names!.includes(c.name))
            : candidates;
          const migrated = await migrateNewSkills(toMigrate, repoRoot);
          // 重扫更新缓存
          cached = await scan();
          saveCache(cached);
          saveBaseline(singleSourceNames(repoRoot));
          return json(res, { migrated, candidates });
        }
        return json(res, { candidates, singleSourceCount: singleSourceNames(repoRoot).size });
      }

      // POST /api/apply — 管理操作（dry-run 或确认执行）
      if (path === "/api/apply" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body) as { req: ApplyRequest; confirm?: boolean };
        const result = executeMutation(payload.req, repoRoot, payload.confirm === true);
        return json(res, result);
      }

      // POST /api/dedupe-apply — 一键去重（dry-run 或确认）
      if (path === "/api/dedupe-apply" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body) as { ids: string[]; keepId?: string; confirm?: boolean };
        if (!payload.ids?.length) return json(res, { error: "ids 为空" }, 400);
        const result = executeDedupe(payload.ids, payload.keepId, repoRoot, payload.confirm === true);
        return json(res, result);
      }

      // POST /api/batch-move — 一键迁移多个资源到单源（dry-run 或确认）
      if (path === "/api/batch-move" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body) as { ids: string[]; confirm?: boolean };
        if (!payload.ids?.length) return json(res, { error: "ids 为空" }, 400);
        const plans = payload.ids.map((id) => planMutation({ type: "move", resourceId: id }, repoRoot));
        if (payload.confirm !== true) return json(res, { planned: plans });
        const results = payload.ids.map((id) => executeMutation({ type: "move", resourceId: id }, repoRoot, true));
        return json(res, { planned: plans, executed: true, count: results.length });
      }

      if (path.startsWith("/api/")) {
        await ensureData();
        // 会话执行轨迹 + 思考
        const sm = path.match(/^\/api\/sessions\/(.+)\/story$/);
        if (sm) {
          const detail = sessionDetail(decodeURIComponent(sm[1]));
          if (!detail) return json(res, { error: "not found" }, 404);
          const { buildStory } = await import("./analysis/story.js");
          return json(res, { id: detail.id, story: buildStory(detail) });
        }
        // 会话详情
        const m = path.match(/^\/api\/sessions\/(.+)$/);
        if (m) {
          const detail = sessionDetail(decodeURIComponent(m[1]));
          return detail ? json(res, detail) : json(res, { error: "not found" }, 404);
        }
        const handler = routes[path];
        if (!handler) return json(res, { error: "not found" }, 404);
        return json(res, await handler(url));
      }

      // 静态页面
      if (path === "/" || path === "/index.html") {
        if (existsSync(htmlPath)) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          return res.end(readFileSync(htmlPath));
        }
        return json(res, { error: "web not built" }, 500);
      }
      return json(res, { error: "not found" }, 404);
    } catch (e) {
      return json(res, { error: (e as Error).message }, 500);
    }
  });

  server.listen(cfg.port, () => {
    console.log(`harness-manager Web 控制面: http://localhost:${cfg.port}`);
  });
}
