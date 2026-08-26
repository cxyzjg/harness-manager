#!/usr/bin/env -S npx tsx
/**
 * harness-manager CLI
 * 用法:
 *   hm scan                     # 扫描三端数据并缓存
 *   hm resources [--json]       # 列出资源
 *   hm sessions [--json]        # 列出会话
 *   hm trace <session-id>       # 显示某会话调用链树
 *   hm slowest [--json]         # 最慢调用 Top
 *   hm token [--json]           # token 聚合
 *   hm dedupe [--json]          # 去重候选
 *   hm memories [--json]        # 记忆/规范文件
 *   hm serve                    # 启动 Web 服务（M3）
 */
import { scan } from "./orchestrator.js";
import { loadCache, saveCache } from "./storage.js";
import { buildCallTree, renderTree, slowestCalls, toolFrequency } from "./analysis/calltree.js";
import { detectDupes } from "./analysis/dedupe.js";
import { filterSessions, aggregateTokens, buildTimeline, contextStats, toolStats } from "./analysis/stats.js";
import type { ScanResult } from "./types.js";

const [, , cmd, ...args] = process.argv;
const useJson = args.includes("--json");

function out(obj: unknown): void {
  console.log(useJson ? JSON.stringify(obj, null, 2) : JSON.stringify(obj, null, 2));
}

async function ensureScan(): Promise<ScanResult> {
  const cached = loadCache();
  if (cached) return cached;
  const fresh = await scan();
  saveCache(fresh);
  return fresh;
}

async function main(): Promise<void> {
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(helpText());
    return;
  }

  switch (cmd) {
    case "scan": {
      const r = await scan();
      saveCache(r);
      console.log(
        `✓ 扫描完成: ${r.resources.length} 资源, ${r.sessions.length} 会话, ${r.memories.length} 记忆, ${r.errors.length} 错误`
      );
      if (r.errors.length) r.errors.forEach((e) => console.log(`  ⚠ ${e}`));
      // 新技能检测 + 询问迁移
      const { detectNewSkills, migrateNewSkills, saveBaseline, singleSourceNames } = await import("./monitor/onboard.js");
      const repoPath = process.env.HM_REPO_ROOT ?? process.cwd();
      const candidates = detectNewSkills(r.resources, repoPath);
      if (candidates.length) {
        console.log(`\n🆕 发现 ${candidates.length} 个新技能（未在单源共享中）:`);
        candidates.forEach((c, i) => console.log(`  ${i + 1}. ${c.name} → ${c.path}`));
        // 非交互模式（--yes 自动迁移）
        if (args.includes("--yes")) {
          const migrated = await migrateNewSkills(candidates, repoPath);
          console.log(`\n✓ 已自动迁移 ${migrated.length} 个到单源`);
        } else if (!args.includes("--no-ask")) {
          // 询问（CLI 无法交互时给出提示命令）
          console.log(`\n是否迁移到单源共享? 执行: npm run hm -- onboard 或 npm run hm -- scan --yes`);
        }
      } else {
        console.log(`\n无新技能（单源 ${singleSourceNames(repoPath).size} 个已全部托管）`);
      }
      // 保存基线
      saveBaseline(singleSourceNames(repoPath));
      break;
    }
    case "onboard": {
      // hm onboard — 手动触发：检测新技能 + 询问迁移
      const { detectNewSkills, migrateNewSkills, saveBaseline, singleSourceNames } = await import("./monitor/onboard.js");
      const r = await ensureScan();
      const repoPath = process.env.HM_REPO_ROOT ?? process.cwd();
      const candidates = detectNewSkills(r.resources, repoPath);
      if (!candidates.length) {
        console.log("无新技能需要迁移（全部已在单源共享）");
        saveBaseline(singleSourceNames(repoPath));
        break;
      }
      console.log(`发现 ${candidates.length} 个新技能:`);
      candidates.forEach((c, i) => console.log(`  ${i + 1}. ${c.name} → ${c.path}`));
      if (!args.includes("-y")) {
        console.log("\n将复制这些技能到单源共享目录 skills/。确认执行请加 -y");
        break;
      }
      const migrated = await migrateNewSkills(candidates, repoPath);
      console.log(`\n✓ 已迁移 ${migrated.length} 个技能到单源共享:`);
      migrated.forEach((m) => console.log(`  • ${m}`));
      // 重新扫描以更新缓存
      const r2 = await scan();
      saveCache(r2);
      saveBaseline(singleSourceNames(repoPath));
      console.log(`\n✓ 缓存已更新，单源共享现有 ${singleSourceNames(repoPath).size} 个技能`);
      break;
    }
    case "resources": {
      const r = await ensureScan();
      if (useJson) return out(r.resources);
      for (const res of r.resources) {
        console.log(
          `[${res.kind}] ${res.name} @ ${res.source}:${res.scope} (${res.status}) — ${res.description ?? ""}`
        );
      }
      break;
    }
    case "sessions": {
      const r = await ensureScan();
      if (useJson) return out(r.sessions);
      for (const s of r.sessions) {
        const toks = s.tokenUsage ? ` tok=${s.tokenUsage.total}` : "";
        console.log(
          `${s.harness} ${s.id.slice(0, 8)} ${s.startedAt ?? "?"} msg=${s.messages} tools=${s.tools.length}${toks} cwd=${s.cwd}`
        );
      }
      break;
    }
    case "trace": {
      const id = args[0];
      if (!id) return console.log("用法: hm trace <session-id>");
      const r = await ensureScan();
      const s = r.sessions.find((x) => x.id.startsWith(id));
      if (!s) return console.log(`未找到会话 ${id}`);
      const tree = buildCallTree(s.tools);
      console.log(`会话 ${s.id} 调用链 (${s.tools.length} 次调用):`);
      // 平铺时按调用序号显示 + 输入摘要 + 耗时
      if (tree.length === s.tools.length && tree.every((n) => n.children.length === 0)) {
        s.tools.forEach((t, i) => {
          const dur = t.durationMs != null ? ` [${t.durationMs}ms]` : "";
          const inp = summarize(t.input);
          console.log(`${String(i + 1).padStart(3)}. ${t.name}${dur} ${inp}`);
        });
      } else {
        console.log(renderTree(tree));
      }
      break;
    }
    case "story": {
      // hm story <id> — 执行轨迹 + 思考过程
      const { buildStory, renderStory } = await import("./analysis/story.js");
      const id = args[0];
      if (!id) return console.log("用法: hm story <session-id>  (执行轨迹+思考过程)");
      const r = await ensureScan();
      const s = r.sessions.find((x) => x.id.startsWith(id));
      if (!s) return console.log(`未找到会话 ${id}`);
      const story = buildStory(s);
      if (useJson) return out(story);
      const thinkCount = story.filter((n) => n.kind === "thinking").length;
      console.log(`会话 ${s.id} 执行轨迹 (${s.tools.length} 次调用, ${thinkCount} 段思考):`);
      console.log(renderStory(story));
      break;
    }
    case "slowest": {
      const r = await ensureScan();
      const all = r.sessions.flatMap((s) => s.tools);
      const slow = slowestCalls(all, 10);
      if (useJson) return out(slow);
      for (const t of slow) {
        console.log(`${t.durationMs}ms  ${t.name}  ${String(t.input ?? "").slice(0, 80)}`);
      }
      break;
    }
    case "token": {
      const r = await ensureScan();
      if (useJson) return out(r.sessions.map((s) => s.tokenUsage));
      let ti = 0, to = 0, msgs = 0;
      for (const s of r.sessions) {
        if (s.tokenUsage) { ti += s.tokenUsage.input; to += s.tokenUsage.output; }
        msgs += s.messages;
      }
      console.log(`总会话: ${r.sessions.length}, 总消息: ${msgs}, 总 input tokens: ${ti}, 总 output tokens: ${to}`);
      break;
    }
    case "dedupe": {
      const r = await ensureScan();
      const dupes = detectDupes(r.resources);
      if (useJson) return out(dupes);
      for (const d of dupes) console.log(`[${d.kind}] ${d.reason}\n    ${d.names.join(", ")}`);
      if (!dupes.length) console.log("未发现去重候选");
      break;
    }
    case "memories": {
      const r = await ensureScan();
      if (useJson) return out(r.memories);
      for (const m of r.memories) {
        console.log(`[${m.kind}] ${m.path} (${m.content.length} chars)`);
      }
      break;
    }
    case "outcome": {
      // hm outcome [sessionId]  — 评估单个或全部会话成效
      const { evaluateAll, evaluateSession } = await import("./monitor/sessionOutcome.js");
      const r = await ensureScan();
      const id = args[0];
      if (id) {
        const s = r.sessions.find((x) => x.id.startsWith(id));
        if (!s) return console.log(`未找到会话 ${id}`);
        const o = evaluateSession(s);
        if (useJson) return out(o);
        printOutcome(o);
      } else {
        const all = evaluateAll(r.sessions);
        if (useJson) return out(all);
        console.log(`会话成效评估 (${all.length} 会话):`);
        for (const o of all) {
          const icon = o.level === "high" ? "🟢" : o.level === "medium" ? "🟡" : "🔴";
          console.log(`${icon} ${String(o.score).padStart(3)} ${o.harness.padEnd(6)} ${o.sessionId.slice(0,20)} ${(o.project||"").slice(0,40)}`);
        }
        console.log("\n提示: hm outcome <sessionId> 查看单个会话详情");
      }
      break;
    }
    case "health": {
      // hm health  — 技能健康监控报告
      const { assessSkillHealth, healthSummary } = await import("./monitor/skillHealth.js");
      const r = await ensureScan();
      const health = assessSkillHealth(r.resources);
      const sum = healthSummary(health);
      if (useJson) return out({ health, summary: sum });
      console.log(`技能健康监控 (${sum.total} 个技能):`);
      console.log(`  🟢 健康 ${sum.byLevel.healthy}  |  🟡 需关注 ${sum.byLevel.attention}  |  🔴 风险 ${sum.byLevel.risk}\n`);
      console.log("待维护动作:");
      if (!sum.actions.length) console.log("  无，全部健康");
      for (const a of sum.actions) console.log(`  • ${a}`);
      console.log("\n风险技能详情:");
      for (const h of health.filter((x) => x.level === "risk" || x.level === "attention").slice(0, 15)) {
        console.log(`  [${h.score}] ${h.resource.name} (${h.resource.source}:${h.resource.scope}) — ${h.issues.join("; ") || "-"}`);
      }
      break;
    }
    case "freq": {
      const r = await ensureScan();
      const all = r.sessions.flatMap((s) => s.tools);
      const f = toolFrequency(all);
      if (useJson) return out(f);
      for (const [k, v] of Object.entries(f).sort((a, b) => b[1] - a[1])) {
        console.log(`${v}\t${k}`);
      }
      break;
    }
    case "search": {
      // hm search [--harness pi] [--project xxx] [--query xxx] [--since 2026-08-01]
      const r = await ensureScan();
      const opts: Record<string, string> = {};
      for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith("--")) opts[args[i].slice(2)] = args[i + 1] ?? "";
      }
      const hits = filterSessions(r.sessions, {
        harness: opts.harness,
        project: opts.project,
        query: opts.query,
        since: opts.since,
      });
      if (useJson) return out(hits);
      console.log(`命中 ${hits.length} 个会话:`);
      for (const s of hits) {
        console.log(`  ${s.harness} ${s.id.slice(0, 20)} ${s.startedAt ?? "?"} msg=${s.messages} tools=${s.tools.length} ${s.cwd}`);
      }
      break;
    }
    case "trend": {
      const r = await ensureScan();
      const agg = aggregateTokens(r.sessions);
      if (useJson) return out(agg);
      console.log(`token 总量: in=${agg.totalInput} out=${agg.totalOutput} total=${agg.total}`);
      console.log("\n按项目:");
      for (const [k, v] of Object.entries(agg.byProject).sort((a, b) => b[1].input - a[1].input)) {
        console.log(`  ${k}: ${v.sessions}会话 in=${v.input} out=${v.output}`);
      }
      console.log("\n按模型:");
      for (const [k, v] of Object.entries(agg.byModel).sort((a, b) => b[1].input - a[1].input)) {
        console.log(`  ${k}: ${v.sessions}会话 in=${v.input} out=${v.output}`);
      }
      break;
    }
    case "timeline": {
      const id = args[0];
      if (!id) return console.log("用法: hm timeline <session-id>");
      const r = await ensureScan();
      const s = r.sessions.find((x) => x.id.startsWith(id));
      if (!s) return console.log(`未找到会话 ${id}`);
      const tl = buildTimeline(s);
      for (const e of tl) {
        const ts = e.ts ? new Date(e.ts).toISOString().slice(11, 19) : "      ";
        const tag = e.kind === "tool" ? `[${e.toolName}]` : `[msg:${e.role ?? ""}]`;
        console.log(`${ts} ${tag.padEnd(14)} ${e.summary}`);
      }
      break;
    }
    case "stats": {
      const r = await ensureScan();
      const cs = contextStats(r.sessions);
      const ts = toolStats(r.sessions);
      if (useJson) return out({ cs, ts });
      console.log(`上下文规模: ${cs.totalSessions}会话 ${cs.totalMessages}消息 平均${cs.avgMessagesPerSession}消息/会话 估算token≈${cs.estimatedTotalTokens}`);
      console.log("\n大会话 Top5:");
      for (const s of cs.largeSessions) console.log(`  ${s.messages} 消息 ${s.id.slice(0, 20)} ${s.cwd}`);
      console.log("\n工具调用 Top10:");
      for (const t of ts.topTools.slice(0, 10)) console.log(`  ${t.count}\t${t.name}`);
      if (ts.slowestInCc.length) {
        console.log("\nCC 慢调用(>1s) Top5:");
        for (const t of ts.slowestInCc.slice(0, 5)) console.log(`  ${t.durationMs}ms ${t.name} ${summarize(t.input)}`);
      }
      break;
    }
    case "deploy": {
      // hm deploy [repoPath] [repoUrl]
      // 在新服务器/新机器上快速部署（每机数据独立，无跨机同步）
      const { deploy } = await import("./deploy.js");
      const repoPath = args[0] ?? process.cwd();
      const repoUrl = args[1] ?? "https://github.com/cxyzjg/harness-manager.git";
      console.log(`部署 harness-manager → ${repoPath}`);
      const result = await deploy(repoPath, repoUrl);
      if (useJson) return out(result);
      for (const s of result.steps) {
        const icon = s.status === "ok" ? "✓" : s.status === "skip" ? "○" : "✗";
        console.log(`${icon} ${s.step}${s.detail ? " — " + s.detail : ""}`);
      }
      console.log(`\n完成。数据目录: ${result.dataDir}`);
      console.log("后续使用: cd 到仓库 → npm run hm -- serve （Web 控制面）");
      break;
    }
    case "apply": {
      // hm apply enable <resourceId> [reason]   (先 dry-run，-y 确认)
      // hm apply disable <resourceId> [reason]
      // hm apply move <resourceId> [target]
      const { planMutation, executeMutation, repoRoot } = await import("./apply.js");
      const op = args[0];
      const resourceId = args[1];
      const param = args.find((a) => a !== "-y" && a !== "--json") && args.filter((a) => a !== "-y" && a !== "--json")[2];
      if (!op || !resourceId) return console.log("用法: hm apply <enable|disable|move> <resourceId> [reason/target]");
      const req = { type: op, resourceId, reason: param, target: param };
      // 先 dry-run
      const plan = planMutation(req as never, repoRoot);
      console.log("将执行:");
      plan.actions.forEach((a) => console.log(`  • ${a}`));
      if (!args.includes("-y")) {
        return console.log("\n这是 dry-run。确认执行请加 -y: hm apply " + args.join(" ") + " -y");
      }
      const result = executeMutation(req as never, repoRoot, true);
      console.log("\n✓ 已执行");
      break;
    }
    case "serve":
      {
        const { startServer } = await import("./server.js");
        // 确保数据已扫描
        const r = await scan();
        saveCache(r);
        console.log(`✓ 已加载 ${r.resources.length} 资源, ${r.sessions.length} 会话`);
        startServer();
      }
      break;
    default:
      console.log(`未知命令: ${cmd}`);
      console.log(helpText());
  }
}

function helpText(): string {
  return `harness-manager CLI

用法:
  hm scan              扫描三端数据并缓存(自动检测新技能)
  hm onboard           手动检测新技能并迁移到单源共享
  hm resources         列出资源 (skills/工具/扩展)
  hm sessions          列出会话
  hm trace <id>        显示会话调用链树
  hm story <id>        执行轨迹 + 思考过程(完整追溯)
  hm slowest           最慢调用 Top10
  hm token             token 聚合
  hm dedupe            去重候选
  hm memories          记忆/规范文件
  hm freq              工具调用频率
  hm search [--project] [--query] [--harness] [--since]   会话检索
  hm trend              token 趋势(按项目/模型)
  hm timeline <id>     会话时间线
  hm stats             上下文规模 + 工具统计 + CC慢调用
  hm outcome [<id>]    会话成效评估(成效分/判断/建议)
  hm health            技能健康监控报告
  hm apply <enable|disable|move> <id> [reason] [-y]   管理操作(dry-run→确认)
  hm deploy [repoPath] [repoUrl]   在新服务器快速部署(每机数据独立)
  hm serve             启动 Web 控制面 (localhost:8787)
`;
}

/** 工具调用入参摘要（避免刷屏长文本） */
function summarize(input: unknown): string {
  if (input == null) return "";
  const s = typeof input === "string" ? input : JSON.stringify(input);
  if (!s) return "";
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > 90 ? oneLine.slice(0, 90) + "…" : oneLine;
}

/** 打印单个会话成效详情 */
function printOutcome(o: { score: number; level: string; sessionId: string; project?: string; startedAt?: string; metrics: Record<string, unknown>; signals: string[]; suggestions: string[] }): void {
  const icon = o.level === "high" ? "🟢" : o.level === "medium" ? "🟡" : "🔴";
  console.log(`${icon} 会话成效: ${o.score} 分 (${o.level})`);
  console.log(`  会话: ${o.sessionId}`);
  console.log(`  项目: ${o.project ?? "-"}  开始: ${o.startedAt ?? "-"}`);
  console.log(`  指标: 调用${String(o.metrics.toolCalls)} 消息${String(o.metrics.messageCount)} token${String(o.metrics.tokenTotal)} 写${String(o.metrics.writeActions)} 读${String(o.metrics.readActions)} 错${String(o.metrics.errors)} 重试${String(o.metrics.retries)}`);
  console.log("  判断依据:");
  o.signals.forEach((s) => console.log(`    • ${s}`));
  console.log("  改进建议:");
  o.suggestions.forEach((s) => console.log(`    • ${s}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
