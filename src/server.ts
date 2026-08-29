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
import { buildLegacyShape, saveResources, getDb } from "./db/store.js";
import { detectDupes } from "./core/skills/dedupe.js";
import { aggregateTokens, contextStats, toolStats } from "./core/sessions/stats.js";
import { buildCallTree } from "./core/sessions/calltree.js";
import { planMutation, executeMutation, executeDedupe, repoRoot, type ApplyRequest } from "./apply.js";
import * as skillCategories from "./core/skills/skillCategories.js";
import { evaluateAll } from "./core/sessions/sessionOutcome.js";
import { assessSkillHealth, healthSummary } from "./core/skills/skillHealth.js";

const htmlPath = join(repoRoot, "src", "web", "index.html");

let cached = buildLegacyShape();
const startedAt = Date.now();

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function ensureData(): Promise<void> {
  if (!cached || !cached.resources.length) {
    const r = await scan();
    saveResources(r.resources);
    cached = buildLegacyShape();
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
  "/api/ops-health": () => {
    let dbOk = false;
    let sessions = 0;
    let dbVersion: number | null = null;
    try {
      const d = getDb();
      dbOk = true;
      sessions = (d.prepare("SELECT COUNT(*) n FROM sessions").get() as { n: number }).n;
      const v = d.prepare("SELECT MAX(version) v FROM schema_migrations").get() as { v: number | null };
      dbVersion = v.v ?? null;
    } catch { dbOk = false; }
    return {
      status: dbOk ? "ok" : "degraded",
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      db: { ok: dbOk, schema_version: dbVersion, sessions },
      version: "0.1.0",
    };
  },
  "/api/dashboard": () => dashboard(),
  "/api/v2/sessions": (url) => {
    const sort = (url.searchParams.get("sort") ?? "active") as "active" | "started" | "tokens";
    return import("./db/store.js").then(({ listSessions, perSessionStats }) => {
      const stats = perSessionStats();
      return listSessions(undefined, sort).map((s) => ({ ...s, stats: stats[s.id] ?? { turns: 0, tools: 0, thinking: 0, tokensIn: 0, tokensOut: 0 } }));
    });
  },
  "/api/v2/context": (url) => {
    // 上下文管理视图: 每turn四段token构成演变(先估算回填再读)
    const id = url.searchParams.get("id") ?? "";
    return import("./db/reviewQuery.js").then(async ({ resolveSessionId }) => {
      const full = resolveSessionId(id);
      if (!full) return null;
      const { estimateContextForSession, contextTimeline } = await import("./db/contextEstimator.js");
      estimateContextForSession(full);
      return contextTimeline(full);
    });
  },
  "/api/v2/review": (url) => {
    const id = url.searchParams.get("id") ?? "";
    return import("./db/reviewQuery.js").then(({ buildReviewFromDb }) => buildReviewFromDb(id));
  },
  "/api/v2/fleet": () => import("./db/reviewQuery.js").then(({ fleetMetrics }) => fleetMetrics()),
  "/api/v2/skill-usage-triage": () =>
    import("./core/skills/usageTriage.js").then(({ triageSkillUsage }) => triageSkillUsage(repoRoot)),
  "/api/v2/summary": (url) => {
    // 会话级摘要: /api/v2/summary?id=<sessionId> ; 时段聚合: 无id
    const id = url.searchParams.get("id") ?? "";
    return import("./db/summary.js").then(({ summarizeSession, periodSummary }) =>
      id ? summarizeSession(id) : periodSummary()
    );
  },
  "/api/v2/anomalies": () =>
    import("./core/anomaly.js").then(({ detectAnomalies }) => ({ anomalies: detectAnomalies(), at: new Date().toISOString() })),
  "/api/v2/model-eval": () =>
    import("./core/modelEval.js").then(({ evaluateModels }) => evaluateModels()),
  "/api/v2/model-compare": (url) => {
    const a = url.searchParams.get("a") ?? "";
    const b = url.searchParams.get("b") ?? "";
    return import("./core/modelEval.js").then(({ compareModels }) => compareModels(a, b));
  },
  "/api/v2/configs": () =>
    import("./db/store.js").then(({ listConfigs }) => listConfigs()),
  "/api/v2/config-compare": async (url) => {
    const a = url.searchParams.get("a") ?? "";
    const b = url.searchParams.get("b") ?? "";
    if (!a || !b) return { error: "需要 a/b 两个配置id" };
    const { compareConfigs } = await import("./core/configCompare.js");
    const { evaluateAll } = await import("./core/sessions/sessionOutcome.js");
    const outcomes = evaluateAll(cached?.sessions ?? []);
    const outcomeOf = new Map(outcomes.map((o) => [o.sessionId, o.score]));
    return compareConfigs(a, b, outcomeOf);
  },
  "/api/v2/skill-effects": async () => {
    const [{ linkSkillEffects }, { assessSkillHealth }] = await Promise.all([
      import("./core/skills/effectLink.js"),
      import("./core/skills/skillHealth.js"),
    ]);
    const sessions = (cached?.sessions ?? []).map((s) => ({ id: s.id, harness: s.harness, started_at: s.startedAt, cwd: s.cwd }));
    // 成效分映射
    const { evaluateAll } = await import("./core/sessions/sessionOutcome.js");
    const outcomes = evaluateAll(cached?.sessions ?? []);
    const outcomeOf = new Map(outcomes.map((o) => [o.sessionId, o.score]));
    const effects = linkSkillEffects(sessions, outcomeOf);
    return { effects, note: "delta>0 表示该技能出现的会话成效高于全局基线" };
  },
  "/api/v2/reliability": () =>
    import("./db/reviewQuery.js").then(({ perSessionReliability, errorDrilldown, retryDrilldown }) => ({
      sessions: perSessionReliability(),
      errors: errorDrilldown(30),
      retries: retryDrilldown(15),
    })),
  "/api/dash": async () => {
    // 仪表盘: 纯量化指标聚合
    const [{ aggregateTokens }, { assessSkillHealth, healthSummary }, { skillUsageStats }] = await Promise.all([
      import("./core/sessions/stats.js"),
      import("./core/skills/skillHealth.js"),
      import("./core/skills/usage.js"),
    ]);
    // 可靠性汇总: 复用SQL版perSessionReliability(修复: 旧JSONL链路因id带前缀匹配不到文件, 恒为0)
    const d = getDb();
    const rel = await import("./db/reviewQuery.js").then(({ perSessionReliability }) => perSessionReliability());
    const grades = { A: 0, B: 0, C: 0, D: 0 };
    let errSum = 0, retrySum = 0;
    for (const r of rel) {
      grades[r.grade as "A" | "B" | "C" | "D"]++;
      errSum += r.errorRate; retrySum += r.retryRate;
    }
    const resources = cached?.resources ?? [];
    const sessions = cached?.sessions ?? [];
    const health = assessSkillHealth(resources);
    const tokens = aggregateTokens(sessions);
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
      // v2 仪表盘增强: 时间趋势 + 成本估算 + 项目排行 + 技能效果关联
      trend: (() => {
        const now = Date.now();
        const win = (from: number, to: number): { sessions: number; tools: number; tokens: number } => {
          let se = 0, to2 = 0, tk = 0;
          for (const s of sessions) {
            const t = s.startedAt ? new Date(s.startedAt).getTime() : 0;
            if (t >= from && t < to) {
              se++;
              const tc = d.prepare("SELECT COUNT(*) n FROM tool_calls WHERE session_id=?").get(s.id) as { n: number };
              to2 += tc.n;
              const c = d.prepare("SELECT COALESCE(SUM(input_tokens+output_tokens),0) n FROM costs WHERE session_id=?").get(s.id) as { n: number };
              tk += c.n;
            }
          }
          return { sessions: se, tools: to2, tokens: tk };
        };
        const now2 = Date.now();
        const cur = win(now2 - 7 * 864e5, now2 + 864e5);
        const prev = win(now2 - 14 * 864e5, now2 - 7 * 864e5);
        return { last7: cur, prev7: prev };
      })(),
      costEstimate: (() => {
        // 主流模型单价表($/1M tokens): 无单价模型归 other 按均值估
        const PRICES: Record<string, { in: number; out: number }> = {
          "glm-5": { in: 0.6, out: 2.2 }, "glm-4.7": { in: 0.5, out: 1.8 },
          "glm-5.1": { in: 0.6, out: 2.2 }, "glm-5.2": { in: 0.6, out: 2.2 },
          "deepseek-v4": { in: 0.27, out: 1.1 },
        };
        const rows = d.prepare(`SELECT COALESCE(c.model, 'unknown') AS model,
            SUM(c.input_tokens) AS i, SUM(c.output_tokens) AS o
          FROM costs c GROUP BY model`).all() as { model: string; i: number; o: number }[];
        let totalUsd = 0;
        const byModel = rows.map((r) => {
          const key = Object.keys(PRICES).find((k) => r.model.toLowerCase().includes(k)) ?? "";
          const price = key ? PRICES[key] : { in: 0.5, out: 1.8 };
          const usd = (r.i / 1e6) * price.in + (r.o / 1e6) * price.out;
          totalUsd += usd;
          return { model: r.model, tokens: r.i + r.o, usd: +usd.toFixed(2) };
        }).sort((a, b) => b.usd - a.usd);
        return { totalUsd: +totalUsd.toFixed(2), note: "按公开价格粗估, 仅供相对比较", byModel };
      })(),
      projects: (() => {
        const map: Record<string, { sessions: number; tools: number; tokens: number; last: string }> = {};
        for (const s of sessions) {
          const key = (s.cwd ?? "?").split(/[\/]/).filter(Boolean).slice(-2).join("/");
          const m = (map[key] ??= { sessions: 0, tools: 0, tokens: 0, last: "" });
          m.sessions++;
          m.tools += s.tools.length;
          m.tokens += s.tokenUsage?.total ?? 0;
          if ((s.startedAt ?? "") > m.last) m.last = s.startedAt ?? "";
        }
        return Object.entries(map).map(([project, v]) => ({ project, ...v })).sort((a, b) => b.tools - a.tools).slice(0, 8);
      })(),
      skillEffects: await import("./core/skills/effectLink.js").then(({ linkSkillEffects }) =>
        linkSkillEffects(sessions.map((s) => ({ id: s.id, harness: s.harness, started_at: s.startedAt, cwd: s.cwd })),
          (() => {
            const out = evaluateAll(sessions);
            return new Map(out.map((o) => [o.sessionId, o.score]));
          })()).slice(0, 8)),
    };
  },
  "/api/skills": async () => {
    // 技能中心聚合: 资源+分类+说明+启停状态+触发统计+健康
    const [{ skillInfo }, { getDisabledSkills }, { skillUsageStats }, { assessSkillHealth, healthSummary }] = await Promise.all([
      import("./core/skills/skillDescriptions.js"),
      import("./core/skills/control.js"),
      import("./core/skills/usage.js"),
      import("./core/skills/skillHealth.js"),
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
          what: skillInfo(r.name)?.what,
          when: skillInfo(r.name)?.when,
          outcome: skillInfo(r.name)?.outcome,
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
  "/api/live": () => import("./core/sessions/realtime.js").then(({ liveSnapshot }) => liveSnapshot()),
  "/api/skill-info": (url) => {
    const name = url.searchParams.get("name") ?? "";
    return import("./core/skills/skillDescriptions.js").then(({ skillInfo }) => skillInfo(name) ?? null);
  },
  "/api/suggest": (url) => {
    const q = url.searchParams.get("q") ?? "";
    return import("./core/skills/skillDescriptions.js").then(({ allSkillInfos }) => {
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
      ? import("./core/sessions/sessionHub.js").then(({ buildSessionHub }) => buildSessionHub(cached!.sessions))
      : null,
  "/api/turns": (url) => {
    const id = url.searchParams.get("id") ?? "";
    if (!id || !cached) return null;
    const s = cached!.sessions.find((x) => x.id.startsWith(id));
    if (!s) return null;
    return import("./core/sessions/turnView.js").then(({ buildTurnViewFromPiFile, buildTurnViewFromCcFile, findPiSessionFile, findCcSessionFile }) =>
      s.harness === "pi"
        ? buildTurnViewFromPiFile(findPiSessionFile(s.id), s.id)
        : buildTurnViewFromCcFile(findCcSessionFile(s.id), s.id)
    );
  },
  "/api/metrics": () => {
    if (!cached) return [];
    return Promise.all([
      import("./core/sessions/metrics.js"),
      import("./core/sessions/turnView.js"),
    ]).then(([{ computeMetrics }, tv]) =>
      cached!.sessions.flatMap((s) => {
        const view = s.harness === "pi"
          ? tv.buildTurnViewFromPiFile(tv.findPiSessionFile(s.id), s.id)
          : tv.buildTurnViewFromCcFile(tv.findCcSessionFile(s.id), s.id);
        return view ? [computeMetrics(view, s)] : [];
      })
    );
  },
  "/api/usage": () => import("./core/skills/usage.js").then(({ skillUsageStats }) => skillUsageStats()),
  "/api/registry": () =>
    import("./core/skills/registry.js").then(({ loadRegistry }) => loadRegistry()),
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
      // 认证(#4): 配置了 authToken 时, API 请求需 Bearer token (/health 与静态页豁免)
      const requiredToken = cfg.authToken;
      if (requiredToken && (path.startsWith("/api/"))) {
        const auth = req.headers["authorization"] ?? "";
        if (auth !== "Bearer " + requiredToken) {
          return json(res, { error: "unauthorized", hint: "设置 Authorization: Bearer <authToken>, 或在前端输入" }, 401);
        }
      }

      // POST /api/onboard — 新技能迁移（检测 + 执行）
      if (path === "/api/onboard" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body) as { names?: string[]; confirm?: boolean };
        const { detectNewSkills, migrateNewSkills, saveBaseline, singleSourceNames } = await import("./core/skills/onboard.js");
        const candidates = detectNewSkills(cached?.resources ?? [], repoRoot);
        if (payload.confirm === true) {
          const toMigrate = payload.names
            ? candidates.filter((c) => payload.names!.includes(c.name))
            : candidates;
          const migrated = await migrateNewSkills(toMigrate, repoRoot);
          // 重扫更新数据(SQLite)
          const rr2 = await scan();
          saveResources(rr2.resources);
          cached = buildLegacyShape();
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

      // 健康检查探针(运维): 不需要数据库也能应答
      if (path === "/health") {
        return json(res, { status: "ok", uptime_s: Math.round((Date.now() - startedAt) / 1000) });
      }

      if (path.startsWith("/api/")) {
        await ensureData();
        // 会话审查聚合: 详情+成效+量化指标+turn回放 一体
        const rm = path.match(/^\/api\/session-review\/(.+)$/);
        if (rm) {
          const id = decodeURIComponent(rm[1]);
          const s = cached!.sessions.find((x) => x.id.startsWith(id));
          if (!s) return json(res, { error: "not found" }, 404);
          const tvmod = await import("./core/sessions/turnView.js");
          const mt = await import("./core/sessions/metrics.js");
          const ot = await import("./core/sessions/sessionOutcome.js");
          const { buildCallTree } = await import("./core/sessions/calltree.js");
          const { buildStory } = await import("./core/sessions/story.js");
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
        // 手动刷新: 立即重扫(新会话/新技能立即可见)
        if (path === "/api/rescan" && req.method === "POST") {
          const rr = await scan();
          saveResources(rr.resources);
          cached = buildLegacyShape();
          // 同步入统一库(SQLite)
          const { runIngest } = await import("./db/ingest.js");
          const report = runIngest();
          // 实时错误回填(pi tool_result -> is_error)
          const { backfillErrors } = await import("./db/errorBackfill.js");
          const bf = backfillErrors();
          const { backfillConfigs } = await import("./db/configBackfill.js");
          const cf = backfillConfigs();
          return json(res, { ok: true, sessions: cached.sessions.length, resources: cached.resources.length, v2: report, backfill: bf, configs: cf });
        }
        // 会话执行轨迹 + 思考
        const sm = path.match(/^\/api\/sessions\/(.+)\/story$/);
        if (sm) {
          const detail = sessionDetail(decodeURIComponent(sm[1]));
          if (!detail) return json(res, { error: "not found" }, 404);
          const { buildStory } = await import("./core/sessions/story.js");
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

      // 静态页面与资源
      if (path === "/" || path === "/index.html") {
        if (existsSync(htmlPath)) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          return res.end(readFileSync(htmlPath));
        }
        return json(res, { error: "web not built" }, 500);
      }
      // 静态资源(css/js): 白名单映射防目录穿越
      const staticFiles: Record<string, { file: string; type: string }> = {
        "/app.css": { file: join(repoRoot, "src", "web", "app.css"), type: "text/css; charset=utf-8" },
        "/app.js": { file: join(repoRoot, "src", "web", "app.js"), type: "application/javascript; charset=utf-8" },
      };
      if (staticFiles[path]) {
        const sf = staticFiles[path];
        if (existsSync(sf.file)) {
          res.writeHead(200, { "Content-Type": sf.type });
          return res.end(readFileSync(sf.file));
        }
        return json(res, { error: "not found" }, 404);
      }
      return json(res, { error: "not found" }, 404);
    } catch (e) {
      return json(res, { error: (e as Error).message }, 500);
    }
  });

  // 启动即全量重扫: 资源入SQLite, 会话由ingest统一处理
  scan().then((r) => {
    saveResources(r.resources);
    cached = buildLegacyShape();
    console.log(`\u2713 \u542f\u52a8\u91cd\u626b: ${r.sessions.length} \u4f1a\u8bdd / ${r.resources.length} \u8d44\u6e90`);
  }).catch(() => {});

  // 启动即同步统一库(SQLite, 阶段1/2链路)
  import("./db/ingest.js")
    .then(({ runIngest }) => {
      const rep = runIngest();
      console.log(`\u2713 \u7edf\u4e00\u5e93\u540c\u6b65: ${rep.stats.sessions} \u4f1a\u8bdd(${rep.harnesses.join("+")}), \u5931\u8d25${rep.failed}`);
      // v2.1: 配置快照回填(等统一库就绪后再跑, 关联需要sessions表)
      return import("./db/errorBackfill.js").then(({ backfillErrors }) => {
        const bf = backfillErrors();
        if (bf.errorsFound) console.log(`\u2713 \u9519\u8bef\u56de\u586b: ${bf.updated} \u6761`);
        return import("./db/configBackfill.js");
      }).then(({ backfillConfigs }) => {
        const cf = backfillConfigs();
        if (cf.snapshots) console.log(`\u2713 \u914d\u7f6e\u5feb\u7167: ${cf.snapshots} \u4e8b\u4ef6 / ${cf.configs} \u7248\u672c / \u5173\u8054${cf.linked}`);
      });
    })
    .catch(() => {});

  // 定时自动扫描(config.scanIntervalMs, 默认60s): 新会话/新技能自动入库
  setInterval(async () => {
    try {
      const r = await scan();
      saveResources(r.resources);
      cached = buildLegacyShape();
      // v2.1 增量回填(错误/配置)
      const { backfillErrors } = await import("./db/errorBackfill.js");
      backfillErrors();
      const { backfillConfigs } = await import("./db/configBackfill.js");
      backfillConfigs();
    } catch { /* 静默 */ }
  }, Math.max(30_000, cfg.scanIntervalMs));

  // 端口占用友好处理(EADDRINUSE): 自动换端口重试, 避免堆栈崩溃
  let portTries = 0;
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && portTries < 5) {
      portTries++;
      const next = cfg.port + portTries;
      console.log(`⚠ 端口 ${cfg.port} 被占用(可能已有驾驶舱实例在运行), 改用 ${next}...`);
      cfg.port = next;
      server.listen(next);
      return;
    }
    console.error(`✗ 服务启动失败: ${err.message}`);
    console.error(`  排查: netstat -ano | findstr ${cfg.port}  找到PID后 taskkill //F //PID <pid>`);
    console.error(`  或改端口: ~/.harness-manager/config.json 的 port 字段`);
    process.exit(1);
  });

  server.listen(cfg.port, () => {
    console.log(`harness-manager Web 控制面: http://localhost:${cfg.port} (每 ${Math.round(cfg.scanIntervalMs / 1000)}s 自动扫描)`);
  });

  // 优雅退出(#2 进程守护配套): 关闭server与db, 不丢处理中请求
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`
收到 ${signal}, 优雅关闭中…`);
    server.close(() => {
      console.log("✓ 已关闭");
      process.exit(0);
    });
    // 兜底: 5s 后强退
    setTimeout(() => process.exit(0), 5000);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
