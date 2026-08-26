/**
 * 扫描编排：聚合三端适配器 → ScanResult
 */
import type { HarnessId, ScanResult } from "./types.js";
import { PiAdapter } from "./adapters/pi.js";
import { ClaudeAdapter } from "./adapters/claude.js";
import { CodexAdapter } from "./adapters/codex.js";
import type { Adapter } from "./adapters/base.js";

export function allAdapters(): Adapter[] {
  return [new PiAdapter(), new ClaudeAdapter(), new CodexAdapter()];
}

export async function scan(enabled: HarnessId[] = ["pi", "claude", "codex"]): Promise<ScanResult> {
  const result: ScanResult = { resources: [], sessions: [], memories: [], errors: [] };
  const ctx = { home: process.env.HOME ?? process.env.USERPROFILE ?? "" };

  for (const adapter of allAdapters()) {
    if (!enabled.includes(adapter.id)) continue;
    try {
      const [resources, sessions, memories] = await Promise.all([
        adapter.readResources(ctx),
        adapter.readSessions(ctx),
        adapter.readMemories(ctx),
      ]);
      result.resources.push(...resources);
      result.sessions.push(...sessions);
      result.memories.push(...memories);
    } catch (e) {
      result.errors.push(`${adapter.id}: ${(e as Error).message}`);
    }
  }
  return result;
}
