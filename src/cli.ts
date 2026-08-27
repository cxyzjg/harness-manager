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
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
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
    case "live": {
      // hm live — 实时监控（pi extension 记录的工具调用）
      const { liveSnapshot } = await import("./monitor/realtime.js");
      const snap = liveSnapshot();
      if (useJson) return out(snap);
      if (!snap.active) {
        console.log("实时监控未启用：需要 pi extension 记录事件。");
        console.log("启用方式: 将 extensions/realtime.ts 注册为 pi 扩展，或用 pi install 安装本包。");
        break;
      }
      console.log(`实时监控 ${snap.logSize} bytes @ ${snap.logPath}`);
      console.log(`\n最近 1h: ${snap.window1h.toolCalls} 次工具调用`);
      const top1h = Object.entries(snap.window1h.byTool).sort((a, b) => b[1] - a[1]).slice(0, 8);
      for (const [k, v] of top1h) console.log(`  ${v}\t${k}`);
      console.log(`\n最近 24h: ${snap.window24h.toolCalls} 次工具调用`);
      if (snap.activeSessions.length) {
        console.log(`\n活跃会话 (${snap.activeSessions.length}):`);
        snap.activeSessions.slice(0, 5).forEach((s) => console.log(`  • ${s.slice(0, 30)}`));
      }
      console.log("\n最近事件:");
      for (const e of snap.recent.slice(0, 10)) {
        const t = e.ts.slice(11, 19);
        if (e.type === "tool_call") console.log(`  ${t} 🛠 ${e.toolName} ${summarize(e.input)}`);
        else if (e.type === "session_start") console.log(`  ${t} ▶ 会话开始 ${e.cwd ?? ""}`);
        else console.log(`  ${t} ■ 会话结束`);
      }
      break;
    }
    case "skill": {
      // hm skill <name> — 查技能中文说明
      const { skillInfo, allSkillInfos } = await import("./analysis/skillDescriptions.js");
      const name = args[0];
      if (!name) {
        console.log("技能中文说明库:");
        const byCat = new Map<string, ReturnType<typeof allSkillInfos>>([]);
        for (const info of allSkillInfos()) {
          byCat.set(info.category, [...(byCat.get(info.category) ?? []), info]);
        }
        for (const [cat, list] of byCat) {
          console.log(`\n${cat} (${list.length}):`);
          list.forEach((i) => console.log(`  ${i.name} — ${i.cnName}: ${i.oneLiner}`));
        }
        break;
      }
      const info = skillInfo(name);
      if (!info) return console.log(`未找到技能 ${name} 的中文说明（可能是未知技能或第三方包技能）`);
      if (useJson) return out(info);
      console.log(`📌 ${info.cnName} (${info.name})`);
      console.log(`   分类: ${info.category}`);
      console.log(`   说明: ${info.oneLiner}`);
      console.log(`   用法: ${info.usage}`);
      break;
    }
    case "suggest": {
      // hm suggest <意图> — 按场景推荐技能
      const { allSkillInfos } = await import("./analysis/skillDescriptions.js");
      const { ALL_CATEGORIES } = await import("./analysis/skillCategories.js");
      const intent = args.join(" ").toLowerCase();
      if (!intent) return console.log("用法: hm suggest <意图>，如 'hm suggest 我要写代码'");
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
      let matchedCat: string | undefined;
      for (const [re, cat] of kw) {
        if (re.test(intent)) { matchedCat = cat; break; }
      }
      const cat = matchedCat ?? "系统工具";
      const list = allSkillInfos().filter((i) => i.category === cat);
      console.log(`按意图 "${args.join(" ")}" 推荐 (${cat}):`);
      list.forEach((i) => console.log(`  • ${i.name} — ${i.cnName}: ${i.oneLiner}`));
      if (!matchedCat) console.log("  (未能识别场景，默认系统工具，可更具体描述)");
      break;
    }
    case "turns": {
      // hm turns <id> - turn 粒度推理轨迹(会话审查回放)
      const { buildTurnViewFromPiFile, buildTurnViewFromCcFile, findPiSessionFile, findCcSessionFile } = await import("./monitor/turnView.js");
      const id = args[0];
      if (!id) return console.log("用法: hm turns <session-id>");
      const r = await ensureScan();
      const s = r.sessions.find((x) => x.id.startsWith(id));
      if (!s) return console.log(`未找到会话 ${id}`);
      // 定位会话文件: pi 按 id 找文件, cc 用 projects
      const tv = s.harness === "pi"
        ? buildTurnViewFromPiFile(findPiSessionFile(s.id), s.id)
        : buildTurnViewFromCcFile(findCcSessionFile(s.id), s.id);
      if (!tv) return console.log("无法构建 turn 视图");
      if (useJson) return out(tv);
      console.log(`会话 ${s.id} turn 轨迹 (${tv.totalTurns} turns, ${tv.totals.tools} 工具, ${tv.totals.thinking} 思考):\n`);
      for (const t of tv.turns) {
        const icon = t.tools.length ? "🛠" : t.thinking.length ? "💭" : "💬";
        console.log(`${icon} [turn ${t.index}] ${(t.ts ?? "").slice(11, 19)} 用户: ${t.userInput.slice(0, 70)}`);
        for (const th of t.thinking.slice(0, 2)) console.log(`    💭 ${(th.text || "").replace(/\s+/g, " ").slice(0, 90)}…`);
        for (const tc of t.tools.slice(0, 5)) console.log(`    🛠 ${tc.name} ${tc.input ?? ""}`);
        if (t.tools.length > 5) console.log(`    … 共${t.tools.length}个工具`);
        const out1 = (t.textOutput[0] ?? "").replace(/\s+/g, " ").slice(0, 70);
        if (out1) console.log(`    ↩ ${out1}`);
        console.log(`    (上下文: ${t.contextAtTurn.messages}消息/${t.contextAtTurn.thinking}思考/${t.contextAtTurn.tools}工具)`);
      }
      break;
    }
    case "metrics": {
      // hm metrics [<id>] - 性能+可靠性量化指标
      const { computeMetrics } = await import("./monitor/metrics.js");
      const { buildTurnViewFromPiFile, buildTurnViewFromCcFile, findPiSessionFile, findCcSessionFile } = await import("./monitor/turnView.js");
      const r = await ensureScan();
      const id = args[0];
      const targets = id ? r.sessions.filter((s) => s.id.startsWith(id)) : r.sessions;
      if (!targets.length) return console.log(`未找到会话 ${id}`);
      const results = targets.flatMap((s) => {
        const tv = s.harness === "pi"
          ? buildTurnViewFromPiFile(findPiSessionFile(s.id), s.id)
          : buildTurnViewFromCcFile(findCcSessionFile(s.id), s.id);
        return tv ? [computeMetrics(tv, s)] : [];
      });
      if (useJson) return out(results);
      if (results.length === 1) {
        const m = results[0];
        console.log(`📊 会话量化指标: ${m.sessionId.slice(0, 30)}`);
        console.log(`\n[性能]`);
        console.log(`  turns=${m.performance.turns} 工具/turn=${m.performance.toolsPerTurn} 思考/turn=${m.performance.thinkingPerTurn}`);
        console.log(`  token=${m.performance.tokensTotal} (每turn ${m.performance.tokensPerTurn}) 上下文增长=${m.performance.contextGrowth}msg 压缩=${m.performance.compactions}次`);
        console.log(`  工具多样性=${m.performance.toolDiversity}`);
        console.log(`\n[可靠性] 等级 ${m.reliability.grade}`);
        console.log(`  错误率=${(m.reliability.errorRate * 100).toFixed(1)}% (${m.reliability.errorCalls}/${m.reliability.totalCalls}) 重试率=${(m.reliability.retryRate * 100).toFixed(1)}% 空转率=${(m.reliability.emptyTurnRate * 100).toFixed(1)}%`);
        m.reliability.signals.forEach((s) => console.log(`  • ${s}`));
      } else {
        console.log(`📊 全部会话量化指标 (${results.length}):`);
        for (const m of results) {
          console.log(`  [${m.reliability.grade}] ${String(m.performance.turns).padStart(3)}turns ${String(m.performance.toolsPerTurn).padStart(4)}t/p ${m.harness.padEnd(6)} ${m.sessionId.slice(0, 22)}`);
        }
        const avg = (k: "errorRate" | "retryRate") => (results.reduce((a, m) => a + m.reliability[k], 0) / results.length * 100).toFixed(1);
        console.log(`\n  平均错误率 ${avg("errorRate")}% 平均重试率 ${avg("retryRate")}%`);
      }
      break;
    }
    case "usage": {
      // hm usage — 技能触发统计
      const { skillUsageStats } = await import("./monitor/usage.js");
      const stats = skillUsageStats();
      if (useJson) return out(stats);
      console.log(`技能触发统计 (共 ${stats.totalTriggers} 次触发):\n`);
      console.log("按技能:");
      const topSkill = Object.entries(stats.bySkill).sort((a, b) => b[1] - a[1]).slice(0, 15);
      for (const [k, v] of topSkill) console.log(`  ${String(v).padStart(3)}  ${k}`);
      if (!topSkill.length) console.log("  (暂无触发记录 — 重启 pi 会话后 extension 会记录 skill_trigger)");
      console.log("\n按项目:");
      const topProj = Object.entries(stats.byProject).sort((a, b) => b[1] - a[1]).slice(0, 8);
      for (const [k, v] of topProj) console.log(`  ${v}\t${k}`);
      console.log("\n最近触发:");
      for (const t of stats.recent.slice(0, 8)) {
        const time = (t.ts ?? "").slice(11, 19);
        console.log(`  ${time} [${(t.skills || []).join(",").slice(0, 50)}] @ ${(t.cwd || "").slice(0, 40)}`);
      }
      break;
    }
    case "registry": {
      // hm registry [rebuild] [resolve <name> <update|keep|ignore>] — 技能注册表管理
      const { rebuildRegistry, loadRegistry, resolveConflict } = await import("./monitor/registry.js");
      const repoPath = process.env.HM_REPO_ROOT ?? process.cwd();
      const sub = args[0];
      if (sub === "rebuild") {
        const reg = rebuildRegistry(repoPath);
        const skills = Object.values(reg.skills);
        const conflicts = skills.filter((s) => s.conflict?.exists);
        console.log(`✓ 注册表重建: ${skills.length} 个技能, ${conflicts.length} 个冲突`);
        if (conflicts.length) {
          console.log("\n冲突技能 (同名不同内容):");
          conflicts.forEach((c) => console.log(`  • ${c.name} — 解决: hm registry resolve ${c.name} update|keep|ignore`));
        }
        if (useJson) return out(reg);
      } else if (sub === "resolve") {
        const name = args[1];
        const action = args[2] as "update" | "keep" | "ignore";
        if (!name || !action) return console.log("用法: hm registry resolve <name> <update|keep|ignore>");
        const reg = loadRegistry();
        resolveConflict(reg, name, action);
        console.log(`✓ 已解决冲突 ${name}: ${action}`);
      } else {
        const reg = loadRegistry();
        const skills = Object.values(reg.skills);
        const conflicts = skills.filter((s) => s.conflict?.exists);
        console.log(`技能注册表: ${skills.length} 个技能`);
        console.log(`  状态: active ${skills.filter((s) => s.state === "active").length} / disabled ${skills.filter((s) => s.state === "disabled").length} / duplicate ${skills.filter((s) => s.state === "duplicate").length}`);
        console.log(`  冲突: ${conflicts.length} 个（hm registry resolve <name> update|keep|ignore）`);
        conflicts.slice(0, 10).forEach((c) => console.log(`    • ${c.name}: 来源 ${c.sources.map((s) => s.kind).join(", ")}`));
      }
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
      // 按分类分组显示
      const { categoryOf, CATEGORY_ICON } = await import("./analysis/skillCategories.js");
      const skills = r.resources.filter((x) => x.kind === "skill" || x.kind === "project-skill");
      const groups = new Map<string, typeof skills>();
      for (const s of skills) {
        const c = categoryOf(s.name);
        groups.set(c, [...(groups.get(c) ?? []), s]);
      }
      // 先显示分类技能，再显示其他资源
      for (const [cat, list] of groups) {
        console.log(`\n${CATEGORY_ICON[cat as keyof typeof CATEGORY_ICON] ?? ""} ${cat} (${list.length}):`);
        for (const s of list) {
          console.log(`  ${s.name} @ ${s.source}:${s.scope} (${s.status}) — ${(s.description ?? "").slice(0, 60)}`);
        }
      }
      const others = r.resources.filter((x) => x.kind !== "skill" && x.kind !== "project-skill");
      if (others.length) {
        console.log(`\n其他资源 (${others.length}):`);
        for (const res of others) console.log(`  [${res.kind}] ${res.name} @ ${res.source}:${res.scope}`);
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
  hm live              实时监控(工具调用/活跃会话, 需pi extension)
  hm usage             技能触发统计(次数/项目/时间/最近记录)
  hm registry          技能注册表管理(统一所有技能源, 冲突解决)
  hm resources         列出资源 (skills/工具/扩展)
  hm skill [<name>]    技能中文说明(全部或单个)
  hm suggest <意图>    按场景推荐技能
  hm sessions          列出会话
  hm trace <id>        显示会话调用链树
  hm story <id>        执行轨迹 + 思考过程(完整追溯)
  hm turns <id>        turn粒度推理轨迹(会话审查回放)
  hm metrics [<id>]    性能+可靠性量化指标(错误率/重试/效率/等级)
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
