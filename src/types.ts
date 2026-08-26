/**
 * harness-manager 统一数据模型（SPEC §Implementation Decisions）
 * 屏蔽 pi / Claude Code / Codex 三端差异。
 */

export type HarnessId = "pi" | "claude" | "codex";

export type ResourceKind = "skill" | "tool" | "extension" | "project-skill" | "prompt" | "theme";

export type ResourceScope = "global" | "project" | "package";

export type ResourceStatus =
  | "active"
  | "candidate"
  | "duplicate-of"
  | "superseded-by";

export interface HarnessResource {
  id: string; // 稳定 id: <harness>:<scope>:<name>
  name: string;
  kind: ResourceKind;
  source: HarnessId | "package" | "single-source";
  scope: ResourceScope;
  path: string;
  status: ResourceStatus;
  harnesses: HarnessId[]; // 被哪些 harness 使用
  description?: string;
  scene?: string; // 场景→技能映射
  duplicateOf?: string; // status=duplicate-of 时指向谁
  supersededBy?: string;
}

export interface ToolCall {
  id: string;
  parentId?: string; // 调用链父子关系
  name: string;
  input?: unknown;
  output?: unknown;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  tokens?: number;
  error?: string;
}

export interface Session {
  id: string;
  harness: HarnessId;
  cwd: string;
  startedAt?: string;
  model?: string;
  messages: number;
  tokenUsage?: { input: number; output: number; total: number };
  tools: ToolCall[];
}

export interface MemoryFile {
  id: string;
  kind: "AGENTS.md" | "CLAUDE.md" | "memory.md" | "plan" | "other";
  path: string;
  content: string;
  updatedAt?: string;
}

export interface ScanResult {
  resources: HarnessResource[];
  sessions: Session[];
  memories: MemoryFile[];
  errors: string[]; // 各适配器读取错误（不阻断）
}
