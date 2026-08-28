/**
 * 调用链重建（SPEC FR-3）
 * 从 ToolCall[]（含 parentId）重建树。
 */
import type { ToolCall } from "../../types.js";

export interface CallNode {
  call: ToolCall;
  children: CallNode[];
  depth: number;
}

export function buildCallTree(tools: ToolCall[]): CallNode[] {
  const byId = new Map<string, CallNode>();
  const roots: CallNode[] = [];

  for (const t of tools) {
    byId.set(t.id, { call: t, children: [], depth: 0 });
  }
  for (const t of tools) {
    const node = byId.get(t.id)!;
    if (t.parentId && byId.has(t.parentId)) {
      const parent = byId.get(t.parentId)!;
      parent.children.push(node);
      node.depth = parent.depth + 1;
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** 找到最慢的 N 个调用 */
export function slowestCalls(tools: ToolCall[], n = 10): ToolCall[] {
  return tools
    .filter((t) => t.durationMs != null)
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    .slice(0, n);
}

/** 统计每个工具被调用次数 */
export function toolFrequency(tools: ToolCall[]): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const t of tools) freq[t.name] = (freq[t.name] ?? 0) + 1;
  return freq;
}

/** 渲染调用链为文本树（供 CLI 展示） */
export function renderTree(nodes: CallNode[], maxDepth = 6): string {
  const lines: string[] = [];
  const walk = (n: CallNode, prefix: string, isLast: boolean): void => {
    if (n.depth > maxDepth) return;
    const c = n.call;
    const dur = c.durationMs != null ? ` [${c.durationMs}ms]` : "";
    const err = c.error ? ` ⚠${c.error.slice(0, 40)}` : "";
    lines.push(`${prefix}${isLast ? "└─" : "├─"} ${c.name}${dur}${err}`);
    const children = n.children;
    for (let i = 0; i < children.length; i++) {
      walk(children[i], prefix + (isLast ? "  " : "│ "), i === children.length - 1);
    }
  };
  nodes.forEach((n, i) => walk(n, "", i === nodes.length - 1));
  return lines.join("\n");
}
