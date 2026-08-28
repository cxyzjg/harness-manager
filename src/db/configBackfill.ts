/**
 * 配置快照回填 (v2.1 D6)
 *
 * 扫描 events.log 的 config_snapshot 事件(pi extension before_agent_start 记录):
 *   system_prompt(8k截断) + skills_loaded + selected_tools
 * -> hash 生成稳定 AgentConfig 入库(同内容=同版本)
 * -> 关联最近会话(cwd+时间邻近) 设置 sessions.agent_config_ref
 *
 * 上下文构成(D5): 从 system_prompt 长度估 system_prompt_tokens(粗估: chars/3),
 * 其他段无可靠来源时留 null —— 宁缺勿造。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getDb, saveAgentConfig, agentConfigId, linkSessionConfig, saveContextSnapshot } from "./store.js";
import type { AgentConfig, HarnessId } from "../core/schema.js";

interface CfgEv {
  ts?: string;
  type?: string;
  cwd?: string;
  system_prompt?: string;
  skills_loaded?: string[];
  selected_tools?: unknown;
}

export function backfillConfigs(): { snapshots: number; configs: number; linked: number } {
  const p = join(homedir(), ".harness-manager", "realtime", "events.log");
  if (!existsSync(p)) return { snapshots: 0, configs: 0, linked: 0 };
  const d = getDb();
  let snapshots = 0;
  const configIds = new Set<string>();
  let linked = 0;

  const lines = readFileSync(p, "utf-8").split("\n").filter(Boolean);
  for (const line of lines) {
    let e: CfgEv;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type !== "config_snapshot" || !e.system_prompt) continue;
    snapshots++;
    const sp: string = e.system_prompt;
    const harness: HarnessId = "pi";
    const { id, hash } = agentConfigId(harness, sp);
    if (!configIds.has(id)) {
      const cfg: AgentConfig = {
        id,
        harness,
        version_hash: hash,
        system_prompt: sp,
        skills_loaded: e.skills_loaded,
        // selected_tools 未必是字符串数组, 保守转换
        allowed_tools: Array.isArray(e.selected_tools) ? (e.selected_tools as unknown[]).map(String) : undefined,
        created_at: e.ts,
      };
      saveAgentConfig(cfg);
      configIds.add(id);
    }

    // 关联最近会话: 同harness(pi) + cwd匹配优先, 时间邻近兜底
    const tsMs = e.ts ? Date.parse(e.ts) : Date.now();
    const norm = (x?: string): string => (x ?? "").replace(/[\\/]+$/, "");
    let sess = e.cwd
      ? (d.prepare("SELECT id, started_at FROM sessions WHERE harness='pi' AND cwd LIKE ? ORDER BY ABS(julianday(COALESCE(started_at,''))) - ? LIMIT 1")
          .get("%" + norm(e.cwd).slice(-40) + "%", tsMs / 86400000) as { id: string } | undefined)
      : undefined;
    if (!sess) {
      sess = d
        .prepare(`SELECT id FROM sessions WHERE harness='pi' ORDER BY ABS(julianday(COALESCE(started_at,'2000-01-01')) - ?) LIMIT 1`)
        .get(tsMs / 86400000) as { id: string } | undefined;
    }
    if (sess) {
      linkSessionConfig(sess.id, id);
      linked++;
      // 上下文构成(D5): system_prompt 粗估(chars/3), 其余留null宁缺勿造
      const turns = d.prepare("SELECT id FROM turns WHERE session_id=? ORDER BY idx LIMIT 1").all(sess.id) as { id: string }[];
      if (turns[0]) {
        saveContextSnapshot({
          turn_id: turns[0].id,
          system_prompt_tokens: Math.round(sp.length / 3),
          snapshot_at: e.ts,
        });
      }
    }
  }
  return { snapshots, configs: configIds.size, linked };
}
