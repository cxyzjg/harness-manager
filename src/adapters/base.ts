/**
 * Adapter 契约（SPEC §Implementation Decisions）
 * 每个 harness 实现此接口。历史读取 + 实时事件订阅。
 */
import type { HarnessResource, Session, MemoryFile, ToolCall } from "../types.js";

export interface AdapterContext {
  home: string;
}

export interface AdapterMutation {
  type: "enable" | "disable" | "move" | "link";
  resource?: string;
  target?: string;
}

export interface Adapter {
  readonly id: "pi" | "claude" | "codex";
  /** 该 harness 在本机是否已使用（~/.codex 为空时 false） */
  readonly available: boolean;
  /** 盘点资源（skills/tools/extensions/项目级） */
  readResources(ctx: AdapterContext): Promise<HarnessResource[]>;
  /** 读取会话 + 调用链 */
  readSessions(ctx: AdapterContext): Promise<Session[]>;
  /** 读取记忆/规范文件 */
  readMemories(ctx: AdapterContext): Promise<MemoryFile[]>;
  /** 实时事件订阅（pi 用 extension hook；CC/Codex 预留文件增量） */
  watch?(ctx: AdapterContext, cb: (session: Session) => void): () => void;
  /** 写操作（dry-run 由上层保证） */
  applyMutation?(mut: AdapterMutation, dryRun: boolean): Promise<string[]>;
}

export function inferToolCalls(raw: unknown): ToolCall[] {
  // 各适配器自行实现；这里留统一签名
  return [] as ToolCall[];
}
