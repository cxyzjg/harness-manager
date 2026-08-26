/**
 * M5 多机 fleet：ssh 汇总各机 inventory + 差异对比（只读）
 * 安全边界：只读拉取远端数据，不向远程写任何内容；变更仍在各机本地执行。
 *
 * 数据来源（按优先级）:
 *   1) 远端已装 harness-manager → 拉取 ~/.harness-manager/cache.json
 *   2) 远端有仓库 → 拉取 docs/STATUS-<host>.md
 *   3) 远端只有 bash → 执行只读盘点命令
 */
import { execFileSync } from "node:child_process";
import type { ScanResult } from "./types.js";

export interface FleetHost {
  name: string; // hostname
  sshTarget: string; // ssh 目标（如 user@host 或 host）
  reachable: boolean;
  error?: string;
  result?: ScanResult; // 远端扫描结果
  summary?: string; // 无结果时的一段文本摘要
}

export interface FleetResult {
  hosts: FleetHost[];
  generatedAt: string;
}

interface FleetOpts {
  sshKey?: string;
  remoteDir?: string; // 远端仓库目录（用于 STATUS 文件）
}

/**
 * 汇总多台主机的 inventory（只读）。
 * @param targets  ssh 目标列表
 */
export function collectFleet(targets: string[], opts: FleetOpts = {}): FleetResult {
  const hosts: FleetHost[] = targets.map((t) => ({
    name: t.split("@").pop() ?? t,
    sshTarget: t,
    reachable: false,
  }));

  for (const h of hosts) {
    try {
      // 1) 尝试远端 cache.json（已装 hm）
      const cache = sshReadJson(h.sshTarget, "~/.harness-manager/cache.json", opts);
      if (cache) {
        h.result = cache as ScanResult;
        h.reachable = true;
        continue;
      }
      // 2) 尝试远端 STATUS 文件（有仓库）
      const status = sshReadText(
        h.sshTarget,
        `${opts.remoteDir ?? "~/harness-manager"}/docs/STATUS-*.md`,
        opts
      );
      if (status) {
        h.summary = status;
        h.reachable = true;
        continue;
      }
      // 3) 只读盘点命令
      const probe = sshExec(h.sshTarget, "ls ~/.pi/agent/sessions 2>/dev/null | wc -l && echo ok", opts);
      if (probe.includes("ok")) {
        h.summary = "远端已安装 pi，但未发现 harness-manager 数据。建议在远端 clone 并运行 hm scan。";
        h.reachable = true;
        continue;
      }
      h.error = "远端不可用（无 hm / 无仓库 / 无 pi）";
    } catch (e) {
      h.error = (e as Error).message;
    }
  }

  return { hosts, generatedAt: new Date().toISOString() };
}

/** 对比两台主机的资源差异 */
export function diffFleet(a: ScanResult | undefined, b: ScanResult | undefined) {
  const toKey = (r: { id: string; name: string; source: string }) =>
    `${r.source}:${r.name}`;
  const aKeys = new Set((a?.resources ?? []).map(toKey));
  const bKeys = new Set((b?.resources ?? []).map(toKey));

  const onlyA = [...aKeys].filter((k) => !bKeys.has(k));
  const onlyB = [...bKeys].filter((k) => !aKeys.has(k));
  const common = [...aKeys].filter((k) => bKeys.has(k));

  return {
    hostA: a?.resources.length ?? 0,
    hostB: b?.resources.length ?? 0,
    onlyA,
    onlyB,
    common: common.length,
    sessionDiff: Math.abs((a?.sessions.length ?? 0) - (b?.sessions.length ?? 0)),
  };
}

// ---------- ssh helpers ----------
function sshArgs(opts: FleetOpts): string[] {
  const args: string[] = ["-o", "ConnectTimeout=10", "-o", "BatchMode=yes"];
  if (opts.sshKey) args.push("-i", opts.sshKey);
  return args;
}

function sshExec(target: string, cmd: string, opts: FleetOpts): string {
  return execFileSync("ssh", [...sshArgs(opts), target, cmd], {
    encoding: "utf-8",
    timeout: 30_000,
  });
}

function sshReadJson(target: string, remotePath: string, opts: FleetOpts): unknown | null {
  const out = sshExec(target, `cat ${remotePath} 2>/dev/null`, opts).trim();
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function sshReadText(target: string, remotePath: string, opts: FleetOpts): string | null {
  const out = sshExec(target, `cat ${remotePath} 2>/dev/null`, opts).trim();
  return out || null;
}
