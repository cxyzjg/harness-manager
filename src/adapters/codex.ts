/**
 * Codex 适配器（预留）
 * ~/.codex 当前无会话数据；结构未知，先探测常见路径。
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { HarnessResource, Session, MemoryFile } from "../types.js";
import type { Adapter, AdapterContext } from "./base.js";

export class CodexAdapter implements Adapter {
  readonly id = "codex" as const;

  get available(): boolean {
    return existsSync(join(homedir(), ".codex"));
  }

  async readResources(ctx: AdapterContext): Promise<HarnessResource[]> {
    const out: HarnessResource[] = [];
    const codex = join(ctx.home, ".codex");
    if (!existsSync(codex)) return out;
    // 探测 skills 目录（约定同 Anthropic skills 结构）
    const skDir = join(codex, "skills");
    if (existsSync(skDir)) {
      for (const name of readdirSync(skDir)) {
        out.push({
          id: `codex:global:${name}`,
          name,
          kind: "skill",
          source: "codex",
          scope: "global",
          path: join(skDir, name),
          status: "active",
          harnesses: ["codex"],
        });
      }
    }
    return out;
  }

  async readSessions(_ctx: AdapterContext): Promise<Session[]> {
    // ~/.codex 当前无会话数据；预留
    return [];
  }

  async readMemories(_ctx: AdapterContext): Promise<MemoryFile[]> {
    return [];
  }
}
