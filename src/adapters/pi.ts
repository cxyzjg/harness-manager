/**
 * pi 适配器
 * - 资源: ~/.pi/agent/skills, ~/.agents/skills, 包 skills, tool-gate, 项目级 .pi/skills
 * - 会话: ~/.pi/agent/sessions/<cwd>/<id>.jsonl（message 事件带 parentId/toolCallId）
 * - 记忆: ~/.pi 无独立记忆文件；AGENTS/CLAUDE 由通用层处理
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  HarnessResource,
  Session,
  MemoryFile,
  ToolCall,
} from "../types.js";
import type { Adapter, AdapterContext } from "./base.js";

interface PiEvent {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  message?: {
    role?: string;
    content?: unknown;
    model?: string;
  };
  provider?: string;
  modelId?: string;
}

export class PiAdapter implements Adapter {
  readonly id = "pi" as const;

  get available(): boolean {
    return existsSync(join(homedir(), ".pi", "agent"));
  }

  private agentDir(ctx: AdapterContext): string {
    return join(ctx.home, ".pi", "agent");
  }

  async readResources(ctx: AdapterContext): Promise<HarnessResource[]> {
    const out: HarnessResource[] = [];
    const agent = this.agentDir(ctx);
    if (!this.available) return out;

    // 全局 skills
    const globalDirs = [
      join(agent, "skills"),
      join(ctx.home, ".agents", "skills"),
    ];
    for (const dir of globalDirs) {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        const sk = join(dir, name, "SKILL.md");
        if (!existsSync(sk)) continue;
        const desc = readDescription(sk);
        out.push({
          id: `pi:global:${name}`,
          name,
          kind: "skill",
          source: "pi",
          scope: "global",
          path: sk,
          status: "active",
          harnesses: ["pi"],
          description: desc,
        });
      }
    }

    // 包 skills（扫描 settings.json packages 对应目录，尽力而为）
    const settingsPath = join(agent, "settings.json");
    if (existsSync(settingsPath)) {
      try {
        const s = JSON.parse(readFileSync(settingsPath, "utf-8"));
        for (const p of s.packages ?? []) {
          const src = typeof p === "string" ? p : p.source;
          if (!src) continue;
          const pkgPath = resolvePackagePath(src, agent);
          if (pkgPath && existsSync(join(pkgPath, "skills"))) {
            for (const name of readdirSync(join(pkgPath, "skills"))) {
              const sk = join(pkgPath, "skills", name, "SKILL.md");
              if (!existsSync(sk)) continue;
              out.push({
                id: `pi:package:${name}`,
                name,
                kind: "skill",
                source: "package",
                scope: "package",
                path: sk,
                status: "active",
                harnesses: ["pi"],
                description: readDescription(sk),
              });
            }
          }
        }
      } catch {
        /* settings 解析失败忽略 */
      }
    }

    // 工具门禁（只读盘点）
    const gatePath = join(agent, "config", "tool-gate.json");
    if (existsSync(gatePath)) {
      try {
        const g = JSON.parse(readFileSync(gatePath, "utf-8"));
        const disabled = (g.disabledGroups ?? []).map((x: string) => x);
        out.push({
          id: "pi:toolgate",
          name: "tool-gate",
          kind: "tool",
          source: "pi",
          scope: "global",
          path: gatePath,
          status: "active",
          harnesses: ["pi"],
          description: `disabledGroups: ${disabled.join(", ") || "(none)"}`,
        });
      } catch {
        /* ignore */
      }
    }

    // 项目级 .pi/skills（信任项目）
    const trustPath = join(agent, "trust.json");
    if (existsSync(trustPath)) {
      try {
        const t = JSON.parse(readFileSync(trustPath, "utf-8"));
        for (const proj of Object.keys(t).filter((k) => t[k])) {
          const pdir = join(proj, ".pi", "skills");
          if (!existsSync(pdir)) continue;
          for (const name of readdirSync(pdir)) {
            const sk = join(pdir, name, "SKILL.md");
            if (!existsSync(sk)) continue;
            out.push({
              id: `pi:project:${name}`,
              name,
              kind: "project-skill",
              source: "pi",
              scope: "project",
              path: sk,
              status: "active",
              harnesses: ["pi"],
              description: readDescription(sk),
            });
          }
        }
      } catch {
        /* ignore */
      }
    }

    return out;
  }

  async readSessions(ctx: AdapterContext): Promise<Session[]> {
    const agent = this.agentDir(ctx);
    const sessionsRoot = join(agent, "sessions");
    if (!existsSync(sessionsRoot)) return [];
    const sessions: Session[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) walk(full);
        else if (entry.endsWith(".jsonl")) {
          const s = parsePiSession(full);
          if (s) sessions.push(s);
        }
      }
    };
    walk(sessionsRoot);
    // 按开始时间降序
    sessions.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
    return sessions;
  }

  async readMemories(_ctx: AdapterContext): Promise<MemoryFile[]> {
    // pi 无独立记忆文件；项目规范由通用层扫描
    return [];
  }
}

/** 解析单个 pi 会话 .jsonl → Session（含调用链） */
export function parsePiSession(path: string): Session | null {
  try {
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    const tools: ToolCall[] = [];
    let messages = 0;
    let cwd = "";
    let startedAt: string | undefined;
    let model: string | undefined;
    let tokenIn = 0;
    let tokenOut = 0;
    let hasTokenData = false;

    for (const line of lines) {
      let ev: PiEvent;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === "session") {
        cwd = (ev as { cwd?: string }).cwd ?? "";
        startedAt = ev.timestamp;
      } else if (ev.type === "model_change") {
        model = ev.modelId ?? ev.provider ?? model;
      } else if (ev.type === "message") {
        messages++;
        const content = ev.message?.content;
        // tool 调用可能内嵌在 assistant message 的 content 里
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c && (c as { type?: string }).type === "toolCall") {
              const tc = c as { id?: string; name?: string; input?: unknown };
              tools.push({
                id: tc.id ?? `tc-${tools.length}`,
                parentId: ev.parentId ?? undefined,
                name: tc.name ?? "unknown",
                input: tc.input,
                startedAt: ev.timestamp,
              });
            }
          }
        }
      } else if (ev.type === "tool_call") {
        tools.push({
          id: ev.toolCallId ?? `tc-${tools.length}`,
          parentId: ev.parentId ?? undefined,
          name: ev.toolName ?? "unknown",
          input: ev.input,
          output: ev.output,
          startedAt: ev.timestamp,
        });
      } else if (ev.type === "usage") {
        const u = ev as { input?: number; output?: number };
        tokenIn += u.input ?? 0;
        tokenOut += u.output ?? 0;
        hasTokenData = true;
      }
    }

    if (messages === 0 && tools.length === 0) return null;
    return {
      id: path.split(/[\\/]/).pop()?.replace(".jsonl", "") ?? path,
      harness: "pi",
      cwd,
      startedAt,
      model,
      messages,
      tokenUsage: hasTokenData
        ? { input: tokenIn, output: tokenOut, total: tokenIn + tokenOut }
        : undefined,
      tools,
    };
  } catch {
    return null;
  }
}

function readDescription(skPath: string): string {
  try {
    const content = readFileSync(skPath, "utf-8");
    const m = content.match(/^description:\s*(.+)$/m);
    return m?.[1]?.slice(0, 200) ?? "";
  } catch {
    return "";
  }
}

/** 解析 settings 里的包路径（npm/git/local） */
function resolvePackagePath(src: string, agent: string): string | null {
  const base = join(agent, "npm", "node_modules");
  if (!existsSync(base)) return null;
  if (src.startsWith("npm:")) {
    const pkg = src.replace("npm:", "").split("@").filter(Boolean)[0] ?? src;
    const scoped = src.replace("npm:", "").startsWith("@");
    // scoped 包: npm:@scope/pkg → node_modules/@scope/pkg
    if (scoped) {
      const [scope, name] = src.replace("npm:", "").split("/");
      const p = join(base, scope, name.split("@")[0]);
      return existsSync(p) ? p : null;
    }
    // 普通包: 遍历 node_modules 找名字匹配（含子目录，限一层）
    const target = src.replace("npm:", "").split("@")[0];
    for (const d of readdirSync(base)) {
      if (d === target) return join(base, d);
    }
    return null;
  }
  if (src.startsWith("git:")) {
    const rest = src.replace("git:", "").replace(/@[\w.-]+$/, "");
    return join(agent, "git", ...rest.split("/"));
  }
  // 本地相对路径：相对 settings 文件（~/.pi/agent）
  return join(agent, src.replace(/^\.\.\/\.\.\/\.\.\/\.\.\//, ""));
}
