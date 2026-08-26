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
    case "serve":
      console.log("M3 Web 服务尚未实现；先使用 hm scan/list/trace/token/dedupe");
      break;
    default:
      console.log(`未知命令: ${cmd}`);
      console.log(helpText());
  }
}

function helpText(): string {
  return `harness-manager CLI

用法:
  hm scan              扫描三端数据并缓存
  hm resources         列出资源 (skills/工具/扩展)
  hm sessions          列出会话
  hm trace <id>        显示会话调用链树
  hm slowest           最慢调用 Top10
  hm token             token 聚合
  hm dedupe            去重候选
  hm memories          记忆/规范文件
  hm freq              工具调用频率
  hm serve             启动 Web 服务 (M3, 未实现)
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
