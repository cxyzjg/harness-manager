/**
 * 驾驶舱统一数据模型 (docs/SCHEMA.md v1)
 * 与具体 harness 无关; 字段英文 snake_case。
 */

export type HarnessId = "pi" | "claude" | "codex" | "dsh";

/** 会话(统一模型) */
export interface UnifiedSession {
  id: string; // {harness}:{文件去扩展名}
  harness: HarnessId;
  cwd?: string;
  started_at?: string;
  ended_at?: string;
  model?: string;
  degraded: boolean;
  source_file?: string;
  agent_config_ref?: string; // v2.1: 会话配置快照引用(D6)
}

/** 用户回合 */
export interface Turn {
  id: string; // {session_id}:t{idx}
  session_id: string;
  idx: number;
  ts?: string;
  user_input: string;
  context_before: { messages: number; thinking: number; tools: number };
}

/** 思考块 */
export interface ThinkingBlock {
  session_id: string;
  turn_id?: string;
  idx: number;
  content: string;
  ts?: string;
}

/** 工具调用 */
export interface ToolCallRecord {
  id: string;
  session_id: string;
  turn_id?: string;
  name: string;
  input?: unknown;
  output?: unknown;
  started_at?: string;
  ended_at?: string;
  duration_ms?: number;
  is_error: boolean;
}

/** 技能触发 */
export interface SkillInvocation {
  ts: string;
  cwd?: string;
  skills: string[];
  prompt_excerpt?: string;
  session_hint?: string;
}

/** 用量 */
export interface CostRecord {
  session_id: string;
  model?: string;
  input_tokens: number;
  output_tokens: number;
  recorded_at?: string;
}

/** 适配器导入结果(含容错明细, 见 SCHEMA.md D2) */
export interface IngestError {
  file: string;
  line?: number;
  reason: string;
}

export interface IngestResult {
  session: UnifiedSession | null; // null = 整个文件不可用
  turns: Turn[];
  thinkings: ThinkingBlock[];
  tool_calls: ToolCallRecord[];
  costs: CostRecord[];
  errors: IngestError[]; // 单条跳过明细
  /** v2.1: turn 级实测上下文总量(pi message.usage.input), 可选 */
  context_snapshots?: ContextSnapshot[];
}

/** 校验: 入库前的守门(见 兼容性承诺) */
export function validateUnified(r: IngestResult): string[] {
  const errs: string[] = [];
  if (r.session === null) return errs; // 整体不可用是合法结果(errors里已有原因)
  if (!r.session.id || !r.session.harness) errs.push("session 缺 id/harness");
  for (const t of r.turns) {
    if (!t.session_id) errs.push(`turn ${t.idx} 缺 session_id`);
    if (typeof t.user_input !== "string") errs.push(`turn ${t.idx} user_input 非字符串`);
  }
  for (const tc of r.tool_calls) {
    if (!tc.name) errs.push(`tool_call ${tc.id} 缺 name`);
    if (!tc.session_id) errs.push(`tool_call ${tc.id} 缺 session_id`);
  }
  return errs;
}

// ============ v2.1: 上下文构成 + Agent配置 (docs/SCHEMA.md v2.1, D5/D6) ============

/** turn 级上下文构成快照 (D5: 4段token拆解) */
export interface ContextSnapshot {
  turn_id: string;
  /** 实测: 该回合 LLM 报告的 input_tokens(= 当时上下文总量, 最可靠) */
  actual_total_tokens?: number;
  system_prompt_tokens?: number;
  history_tokens?: number;
  tool_result_tokens?: number;
  file_content_tokens?: number;
  memory_entries_used?: string[];
  snapshot_at?: string;
}

/** agent 配置快照 (D6: 每会话快照, 独立可追溯) */
export interface AgentConfig {
  id: string; // cfg_{harness}_{hash12}
  harness: HarnessId;
  version_hash: string; // 内容sha256前12位
  system_prompt: string; // 截断8k
  model?: string;
  thinking_level?: string;
  allowed_tools?: string[];
  skills_loaded?: string[];
  created_at?: string;
}

/** 扩展 IngestResult (可选字段, 旧适配器不填也不破坏) */
export interface ConfigRefResult {
  agent_config?: AgentConfig;
}
