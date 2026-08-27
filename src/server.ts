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
  "/api/dash": async () => {
    // 仪表盘: 纯量化指标聚合
    const [{ aggregateTokens }, { assessSkillHealth, healthSummary }, { skillUsageStats }] = await Promise.all([
      import("./analysis/stats.js"),
      import("./monitor/skillHealth.js"),
      import("./monitor/usage.js"),
    ]);
    const mt = cached ? await import("./monitor/metrics.js") : null;
    const tv = cached ? await import("./monitor/turnView.js") : null;
    const resources = cached?.resources ?? [];
    const sessions = cached?.sessions ?? [];
    const health = assessSkillHealth(resources);
    const tokens = aggregateTokens(sessions);
    // 全会话可靠性汇总
    let errSum = 0, retrySum = 0, grades = { A: 0, B: 0, C: 0, D: 0 };
    if (mt && tv) {
      for (const s of sessions) {
        const view = s.harness === "pi"
          ? tv.buildTurnViewFromPiFile(tv.findPiSessionFile(s.id), s.id)
          : tv.buildTurnViewFromCcFile(tv.findCcSessionFile(s.id), s.id);
        if (!view) continue;
        const m2 = mt.computeMetrics(view, s);
        errSum += m2.reliability.errorRate; retrySum += m2.reliability.retryRate;
        grades[m2.reliability.grade]++;
      }
    }
    const quantified = Object.values(grades).reduce((a, b) => a + b, 0);
    const usage = skillUsageStats();
    return {
      resources: {
        total: resources.length,
        skills: (cached?.resources ?? []).filter((r) => r.kind === "skill" || r.kind === "project-skill").length,
        bySource: countBy(resources, (r) => r.source),
      },
      skillsHealth: { summary: healthSummary(health) },
      tokens: { total: tokens.total, input: tokens.totalInput, output: tokens.totalOutput,
        byModel: Object.entries(tokens.byModel).map(([k, v]) => ({ model: k, ...v })).sort((a, b) => b.input - a.input).slice(0, 6),
        byProject: Object.entries(tokens.byProject).map(([k, v]) => ({ project: k, ...v })).sort((a, b) => b.input - a.input).slice(0, 6) },
      sessions: { total: sessions.length, tools: sessions.reduce((a, s) => a + s.tools.length, 0), messages: sessions.reduce((a, s) => a + s.messages, 0) },
      reliability: { quantified, avgErrorRate: quantified ? +((errSum / quantified) * 100).toFixed(1) : 0,
        avgRetryRate: quantified ? +((retrySum / quantified) * 100).toFixed(1) : 0, grades },
      triggers: { total: usage.totalTriggers, top: Object.entries(usage.bySkill).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })) },
    };
  },
  "/api/skills": async () => {
    // 技能中心聚合: 资源+分类+说明+启停状态+触发统计+健康
    const [{ skillInfo }, { getDisabledSkills }, { skillUsageStats }, { assessSkillHealth, healthSummary }] = await Promise.all([
      import("./analysis/skillDescriptions.js"),
      import("./core/skills/control.js"),
      import("./monitor/usage.js"),
      import("./monitor/skillHealth.js"),
    ]);
    const disabled = new Set(getDisabledSkills());
    const usage = skillUsageStats();
    const resources = cached?.resources ?? [];
    const health = assessSkillHealth(resources);
    const healthByName = new Map(health.map((h) => [h.resource.name, h]));
    const skills = resources
      .filter((r) => r.kind === "skill" || r.kind === "project-skill")
      .map((r) => {
        const cat = skillCategories.categoryOf(r.name);
        return {
          ...r,
          category: cat,
          categoryIcon: skillCategories.CATEGORY_ICON[cat],
          cnName: skillInfo(r.name)?.cnName,
          oneLiner: skillInfo(r.name)?.oneLiner,
          usageHint: skillInfo(r.name)?.usage,
          enabled: !disabled.has(r.name),
          triggerCount: usage.bySkill[r.name] ?? 0,
          healthScore: healthByName.get(r.name)?.score,
          healthLevel: healthByName.get(r.name)?.level,
          issues: healthByName.get(r.name)?.issues ?? [],
        };
      });
    return { skills, summary: healthSummary(health), triggers: usage.totalTriggers, byProject: usage.byProject, recent: usage.recent.slice(0, 10) };
  },
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
  "/api/skill-info": (url) => {
    const name = url.searchParams.get("name") ?? "";
    return import("./analysis/skillDescriptions.js").then(({ skillInfo }) => skillInfo(name) ?? null);
  },
  "/api/suggest": (url) => {
    const q = url.searchParams.get("q") ?? "";
    return import("./analysis/skillDescriptions.js").then(({ allSkillInfos }) => {
      const kw: [RegExp, string][] = [
        [/审|review|检查代码/, "质量调试"],
        [/bug|调试|排查|出错/, "质量调试"],
        [/需求|想法|规划|该做|要什么/, "需求规划"],
        [/设计|架构|模块/, "设计架构"],
        [/写代码|开发|实现|编码/, "开发编码"],
        [/进度|下一步|状态|部署/, "项目进度"],
        [/交接|协作|并行|教/, "协作交接"],
        [/写作|文档|计划|报告/, "沟通写作"],
        [/技能|资源|安装|管理/, "系统工具"],
      ];
      const intent = q.toLowerCase();
      let cat: string | undefined;
      for (const [re, c] of kw) if (re.test(intent)) { cat = c; break; }
      const c = cat ?? "系统工具";
      return { category: c, suggestions: allSkillInfos().filter((i) => i.category === c).slice(0, 10) };
    });
  },
  "/api/hub": () =>
    cached
      ? import("./monitor/sessionHub.js").then(({ buildSessionHub }) => buildSessionHub(cached!.sessions))
      : null,
  "/api/turns": (url) => {
    const id = url.searchParams.get("id") ?? "";
    if (!id || !cached) return null;
    const s = cached!.sessions.find((x) => x.id.startsWith(id));
    if (!s) return null;
    return import("./monitor/turnView.js").then(({ buildTurnViewFromPiFile, buildTurnViewFromCcFile, findPiSessionFile, findCcSessionFile }) =>
      s.harness === "pi"
        ? buildTurnViewFromPiFile(findPiSessionFile(s.id), s.id)
        : buildTurnViewFromCcFile(findCcSessionFile(s.id), s.id)
    );
  },
  "/api/metrics": () => {
    if (!cached) return [];
    return Promise.all([
      import("./monitor/metrics.js"),
      import("./monitor/turnView.js"),
    ]).then(([{ computeMetrics }, tv]) =>
      cached!.sessions.flatMap((s) => {
        const view = s.harness === "pi"
          ? tv.buildTurnViewFromPiFile(tv.findPiSessionFile(s.id), s.id)
          : tv.buildTurnViewFromCcFile(tv.findCcSessionFile(s.id), s.id);
        return view ? [computeMetrics(view, s)] : [];
      })
    );
  },
  "/api/usage": () => import("./monitor/usage.js").then(({ skillUsageStats }) => skillUsageStats()),
  "/api/registry": () =>
    import("./monitor/registry.js").then(({ loadRegistry }) => loadRegistry()),
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
        // 会话审查聚合: 详情+成效+量化指标+turn回放 一体
        const rm = path.match(/^\/api\/session-review\/(.+)$/);
        if (rm) {
          const id = decodeURIComponent(rm[1]);
          const s = cached!.sessions.find((x) => x.id.startsWith(id));
          if (!s) return json(res, { error: "not found" }, 404);
          const tvmod = await import("./monitor/turnView.js");
          const mt = await import("./monitor/metrics.js");
          const ot = await import("./monitor/sessionOutcome.js");
          const { buildCallTree } = await import("./analysis/calltree.js");
          const { buildStory } = await import("./analysis/story.js");
          const tv = s.harness === "pi"
            ? tvmod.buildTurnViewFromPiFile(tvmod.findPiSessionFile(s.id), s.id)
            : tvmod.buildTurnViewFromCcFile(tvmod.findCcSessionFile(s.id), s.id);
          const outcome = ot.evaluateAll([s])[0] ?? null;
          const metrics2 = tv ? mt.computeMetrics(tv, s) : null;
          return json(res, {
            id: s.id, harness: s.harness, cwd: s.cwd, startedAt: s.startedAt,
            messages: s.messages, toolCount: s.tools.length, tokenUsage: s.tokenUsage ?? null,
            outcome, metrics: metrics2,
            turns: tv ? { total: tv.totalTurns, list: tv.turns } : null,
            story: buildStory(s), tree: buildCallTree(s.tools),
          });
        }
        // 技能真启停 toggle
        if (path === "/api/skills/toggle" && req.method === "POST") {
          let body = "";
          for await (const chunk of req) body += chunk;
          const p = JSON.parse(body) as { name: string; enabled: boolean };
          const { setSkillEnabled, getDisabledSkills } = await import("./core/skills/control.js");
          setSkillEnabled(p.name, p.enabled === true);
          return json(res, { ok: true, name: p.name, enabled: p.enabled === true, disabledList: getDisabledSkills() });
        }
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
