/**
 * Claude Code 适配器
 * - 会话: ~/.claude/projects/<cwd>/<id>.jsonl（type: tool_use / assistant / user）
 * - 资源: ~/.claude/skills, 项目 .claude/skills
 * - 记忆: ~/.claude (memory 相关)、项目 CLAUDE.md
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { HarnessResource, Session, MemoryFile, ToolCall } from "../types.js";
import type { Adapter, AdapterContext } from "./base.js";

interface CcEvent {
  type?: string;
  sessionId?: string;
  timestamp?: string;
  parentToolUseId?: string;
  name?: string;
  input?: unknown;
  message?: {
    role?: string;
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
    content?: unknown;
  };
  tool_use_id?: string;
  tool_use_error?: unknown;
  cwd?: string;
}

export class ClaudeAdapter implements Adapter {
  readonly id = "claude" as const;

  get available(): boolean {
    return existsSync(join(homedir(), ".claude"));
  }

  private claudeDir(ctx: AdapterContext): string {
    return join(ctx.home, ".claude");
  }

  /** 项目级路径候选：pi trust.json 的项目 + CC projects 目录名反推 */
  private projectPaths(ctx: AdapterContext): string[] {
    const found: string[] = [];
    // 1) pi trust.json 的项目路径（最可靠）
    try {
      const trust = JSON.parse(
        readFileSync(join(ctx.home, ".pi", "agent", "trust.json"), "utf-8")
      );
      for (const p of Object.keys(trust)) {
        if (trust[p]) found.push(p.replace(/\\/g, "/"));
      }
    } catch { /* ignore */ }
    // 2) CC projects 目录名反推（唯一可逆部分）
    const projects = join(this.claudeDir(ctx), "projects");
    if (existsSync(projects)) {
      for (const pdir of readdirSync(projects)) {
        // 尝试: 反转义 -- → 分隔符；仅作路径存在性候选
        const guessed = pdir
          .replace(/^C--/, "C:/")
          .replace(/--/g, "/")
          .replace(/-/g, "_"); // 弱猜测
        found.push(guessed);
      }
    }
    // 去重
    return [...new Set(found)];
  }

  async readResources(ctx: AdapterContext): Promise<HarnessResource[]> {
    const out: HarnessResource[] = [];
    const claude = this.claudeDir(ctx);
    if (!this.available) return out;

    // 全局 skills
    const gdir = join(claude, "skills");
    if (existsSync(gdir)) {
      for (const name of readdirSync(gdir)) {
        const sk = join(gdir, name, "SKILL.md");
        if (!existsSync(sk)) continue;
        out.push({
          id: `claude:global:${name}`,
          name,
          kind: "skill",
          source: "claude",
          scope: "global",
          path: sk,
          status: "active",
          harnesses: ["claude"],
          description: readDesc(sk),
        });
      }
    }

    // 项目级 .claude/skills（从 trust 项目 + CC projects 反推）
    for (const real of this.projectPaths(ctx)) {
      const skDir = join(real, ".claude", "skills");
      if (!existsSync(skDir)) continue;
      for (const name of readdirSync(skDir)) {
        const sk = join(skDir, name, "SKILL.md");
        if (!existsSync(sk)) continue;
        out.push({
          id: `claude:project:${name}`,
          name,
          kind: "project-skill",
          source: "claude",
          scope: "project",
          path: sk,
          status: "active",
          harnesses: ["claude"],
          description: readDesc(sk),
        });
      }
    }

    return out;
  }

  async readSessions(ctx: AdapterContext): Promise<Session[]> {
    const claude = this.claudeDir(ctx);
    const projects = join(claude, "projects");
    if (!existsSync(projects)) return [];
    const sessions: Session[] = [];

    for (const pdir of readdirSync(projects)) {
      const full = join(projects, pdir);
      if (!statSync(full).isDirectory()) continue;
      const real = pdir.replace(/--/g, "\\").replace(/^C\\/, "C:\\");
      for (const f of readdirSync(full)) {
        if (!f.endsWith(".jsonl")) continue;
        const s = parseCcSession(join(full, f), real);
        if (s) sessions.push(s);
      }
    }
    sessions.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
    return sessions;
  }

  async readMemories(ctx: AdapterContext): Promise<MemoryFile[]> {
    const claude = this.claudeDir(ctx);
    const out: MemoryFile[] = [];
    // ~/.claude 下记忆相关
    const candidates = [
      { f: "memory.md", kind: "memory.md" as const },
      { f: "CLAUDE.md", kind: "CLAUDE.md" as const },
    ];
    for (const c of candidates) {
      const p = join(claude, c.f);
      if (existsSync(p)) {
        out.push({
          id: `claude:memory:${c.f}`,
          kind: c.kind,
          path: p,
          content: readFileSync(p, "utf-8").slice(0, 10_000),
          updatedAt: statSync(p).mtime.toISOString(),
        });
      }
    }
    // 项目级 CLAUDE.md（trust 项目路径）
    for (const real of this.projectPaths(ctx)) {
      const p = join(real, "CLAUDE.md");
      if (existsSync(p)) {
        out.push({
          id: `claude:project:${real.replace(/[^a-zA-Z0-9]/g, "-")}:CLAUDE.md`,
          kind: "CLAUDE.md",
          path: p,
          content: readFileSync(p, "utf-8").slice(0, 10_000),
          updatedAt: statSync(p).mtime.toISOString(),
        });
      }
    }
    return out;
  }
}

/** 解析单个 CC 会话 .jsonl → Session（含 tool_use 调用链） */
export function parseCcSession(path: string, cwdGuess: string): Session | null {
  try {
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    const tools: ToolCall[] = [];
    let messages = 0;
    let model: string | undefined;
    let startedAt: string | undefined;
    let tokenIn = 0;
    let tokenOut = 0;
    let hasToken = false;

    for (const line of lines) {
      let ev: CcEvent;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === "assistant" || ev.type === "user") {
        messages++;
        startedAt ??= ev.timestamp;
        if (ev.message?.model) model = ev.message.model;
        const usage = ev.message?.usage;
        if (usage) {
          tokenIn += usage.input_tokens ?? 0;
          tokenOut += usage.output_tokens ?? 0;
          hasToken = true;
        }
      } else if (ev.type === "tool_use") {
        tools.push({
          id: ev.tool_use_id ?? ev.name ?? `tc-${tools.length}`,
          parentId: ev.parentToolUseId ?? undefined,
          name: ev.name ?? "unknown",
          input: ev.input,
          startedAt: ev.timestamp,
        });
      } else if (ev.type === "tool_result") {
        // 关联结果到已存在调用（同 id）
        const t = tools.find((x) => x.id === ev.tool_use_id);
        if (t) {
          t.output = ev.input;
          t.endedAt = ev.timestamp;
        }
      }
    }

    if (messages === 0 && tools.length === 0) return null;
    return {
      id: path.split(/[\\/]/).pop()?.replace(".jsonl", "") ?? path,
      harness: "claude",
      cwd: cwdGuess,
      startedAt,
      model,
      messages,
      tokenUsage: hasToken ? { input: tokenIn, output: tokenOut, total: tokenIn + tokenOut } : undefined,
      tools,
    };
  } catch {
    return null;
  }
}

function readDesc(p: string): string {
  try {
    const m = readFileSync(p, "utf-8").match(/^description:\s*(.+)$/m);
    return m?.[1]?.slice(0, 200) ?? "";
  } catch {
    return "";
  }
}
