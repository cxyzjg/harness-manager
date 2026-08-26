/**
 * 执行轨迹 + 思考过程重建（闭环监控 - 会话轨迹的核心视图）
 *
 * 把会话重建成"思考(为什么) → 工具(做了什么) → 结果"的完整执行轨迹，
 * 用于追溯、跟踪、判断会话成效。
 */
import type { Session, ToolCall } from "../types.js";

export type StoryNodeKind = "thinking" | "tool" | "summary";

export interface StoryNode {
  kind: StoryNodeKind;
  /** thinking: 思考内容; tool: 工具名; summary: 文本 */
  label: string;
  detail?: string;
  timestamp?: string;
  toolId?: string;
  toolInput?: string;
  toolOutput?: string;
  toolError?: boolean;
  children?: StoryNode[];
}

/**
 * 重建会话执行轨迹。
 * 优先用 thinkings 序列，其次从 toolCall.thinking 推断。
 */
export function buildStory(s: Session): StoryNode[] {
  const story: StoryNode[] = [];
  const tools = s.tools ?? [];
  const thinkings = s.thinkings ?? [];

  // 如果 thinkings 有 followedByToolIds，按批次对齐
  if (thinkings.length) {
    const toolByBatch = new Map<string, StoryNode[]>();
    let usedToolIds = new Set<string>();
    for (const th of thinkings) {
      const node: StoryNode = {
        kind: "thinking",
        label: "💭 思考",
        detail: th.content,
        timestamp: th.timestamp,
      };
      // 找紧随其后的工具
      const followIds = (th.followedByToolIds ?? []).filter((id) => !usedToolIds.has(id));
      const followTools = followIds
        .map((id) => tools.find((t) => t.id === id))
        .filter((t): t is ToolCall => !!t);
      if (followTools.length) {
        node.children = followTools.map((t) => toToolNode(t));
        followIds.forEach((id) => usedToolIds.add(id));
      }
      story.push(node);
    }
    // 剩余的未关联工具
    const leftover = tools.filter((t) => !usedToolIds.has(t.id));
    for (const t of leftover) story.push(toToolNode(t));
    return story;
  }

  // 兜底：从 toolCall.thinking 按顺序交错
  for (const t of tools) {
    if (t.thinking && story[story.length - 1]?.label !== t.thinking) {
      story.push({ kind: "thinking", label: "💭 思考", detail: t.thinking, timestamp: t.startedAt });
    }
    story.push(toToolNode(t));
  }
  return story;
}

function toToolNode(t: ToolCall): StoryNode {
  const out: StoryNode = {
    kind: "tool",
    label: t.name,
    toolId: t.id,
    detail: summarize(t.input),
    toolInput: summarize(t.input),
    timestamp: t.startedAt,
  };
  if (t.output != null) out.toolOutput = summarize(t.output, 200);
  if (t.error || /error/i.test(String(t.output ?? ""))) out.toolError = true;
  if (t.durationMs != null) out.label = `${t.name} [${t.durationMs}ms]`;
  return out;
}

/** 渲染为文本轨迹（CLI 用） */
export function renderStory(nodes: StoryNode[], maxThinking = 400): string {
  const lines: string[] = [];
  let idx = 0;
  for (const n of nodes) {
    if (n.kind === "thinking") {
      const detail = (n.detail ?? "").replace(/\s+/g, " ").trim();
      lines.push(`\n💭 思考: ${detail.length > maxThinking ? detail.slice(0, maxThinking) + "…" : detail}`);
      // 渲染紧随其后的工具
      if (n.children?.length) {
        for (const c of n.children) {
          idx++;
          const input = c.toolInput ? ` ${c.toolInput}` : "";
          const err = c.toolError ? " ⚠" : "";
          lines.push(`${String(idx).padStart(3)}. ${c.label}${err}${input}`);
        }
      }
    } else {
      idx++;
      const input = n.toolInput ? ` ${n.toolInput}` : "";
      const err = n.toolError ? " ⚠" : "";
      lines.push(`${String(idx).padStart(3)}. ${n.label}${err}${input}`);
      if (n.children) {
        for (const c of n.children) {
          lines.push(`      └─ ${c.label}${c.toolInput ? " " + c.toolInput : ""}`);
        }
      }
    }
  }
  return lines.join("\n");
}

function summarize(input: unknown, max = 120): string {
  if (input == null) return "";
  const s = typeof input === "string" ? input : JSON.stringify(input);
  if (!s) return "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max) + "…" : one;
}
