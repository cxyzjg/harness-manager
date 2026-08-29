/**
 * harness-manager 实时监控 extension（pi 侧）
 *
 * 订阅 pi 的实时事件（tool_call / session_start / session_shutdown），
 * 把"正在发生"的工具调用写入 ~/.harness-manager/realtime/events.log
 * （追加行 JSON），供 harness-manager 的实时监控面板读取。
 *
 * 安装：把本文件放入 pi 的 extensions 目录（或作为包的一部分），
 * 或参考 pi 文档将包含本文件的包加入 settings.packages。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import Database from "better-sqlite3";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const LOG_DIR = join(homedir(), ".harness-manager", "realtime");
const LOG_FILE = join(LOG_DIR, "events.log");

function logEvent(type: string, data: Record<string, unknown>): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), type, ...data });
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    /* 日志写入失败不影响 pi 运行 */
  }
}

export default function (pi: ExtensionAPI): void {
  // 安全注册: handler 异常不影响 pi 本身(只记错误日志)
  const safeOn = (event: string, handler: (ev: unknown) => Promise<unknown>): void => {
    pi.on(event, async (ev: unknown) => {
      try {
        return await handler(ev);
      } catch (err) {
        logEvent("extension_error", { event, message: String((err as Error).message ?? err).slice(0, 200) });
        return undefined; // 降级: 不阻断 pi
      }
    });
  };

  // 会话开始
  safeOn("session_start", async (event: unknown, ctx: unknown) => {
    const ev2 = event as { reason?: string; cwd?: string };
    logEvent("session_start", {
      reason: ev2.reason ?? "unknown",
      cwd: ev2.cwd ?? "",
    });
    // Q5: 工作流嵌入 — 会话启动时展示驾驶舱摘要
    try {
      const c2 = ctx as { ui?: { notify?: (msg: string, level?: string) => void } };
      if (true) {
        const db = new Database(join(homedir(), ".harness-manager", "db.sqlite"), { readonly: true });
        const sessions = (db.prepare("SELECT COUNT(*) n FROM sessions").get() as { n: number }).n;
        const tools = (db.prepare("SELECT COUNT(*) n FROM tool_calls").get() as { n: number }).n;
        const errs = (db.prepare("SELECT COALESCE(SUM(is_error),0) n FROM tool_calls").get() as { n: number }).n;
        db.close();
        c2.ui?.notify?.(`📊 驾驶舱: ${sessions} 会话 · ${tools} 工具调用 · ${errs} 错误 — hm dash 查看`, "info");
      }
    } catch { /* 统计失败静默 */ }
  });

  // 会话结束
  safeOn("session_shutdown", async () => {
    logEvent("session_shutdown", {});
  });

  // 上下文压缩事件(P3: 上下文管理可见)
  safeOn("session_before_compact", async (event) => {
    const e = event as { reason?: string; entryCount?: number; model?: string };
    logEvent("compaction", {
      reason: e.reason ?? "auto",
      entries: e.entryCount ?? 0,
    });
    // 不取消压缩, 仅观测
    return undefined;
  });

  // 模型切换(P3: state 可见)
  safeOn("session_info_changed", async (event) => {
    const e = event as { model?: string; provider?: string; thinkingLevel?: string };
    if (e.model || e.provider) {
      logEvent("model_change", { model: e.model ?? "", provider: e.provider ?? "", thinkingLevel: e.thinkingLevel ?? "" });
    }
    return undefined;
  });

  // 工具调用（核心：实时监控）
  safeOn("tool_call", async (event) => {
    const e = event as {
      toolName?: string;
      input?: unknown;
      toolCallId?: string;
      sessionId?: string;
    };
    logEvent("tool_call", {
      toolName: e.toolName ?? "unknown",
      input: e.input,
      toolCallId: e.toolCallId ?? "",
      sessionId: e.sessionId ?? "",
    });
    // 不阻塞、不修改工具调用（纯监控）
    return undefined;
  });

  // 工具结果(①补pi实时错误率): 记录 isError/耗时 -> events.log
  safeOn("tool_result", async (event) => {
    const e = event as {
      toolName?: string;
      toolCallId?: string;
      isError?: boolean;
      content?: unknown;
      usage?: unknown;
    };
    logEvent("tool_result", {
      toolName: e.toolName ?? "unknown",
      toolCallId: e.toolCallId ?? "",
      isError: e.isError === true,
      contentExcerpt: typeof e.content === "string" ? e.content.slice(0, 200) : undefined,
    });
    // 不改结果, 仅观测
    return undefined;
  });

  // 技能触发追踪 + 真启停过滤: 用户每回合记录已加载技能, 并从系统提示移除禁用技能
  safeOn("before_agent_start", async (event) => {
    const e = event as {
      prompt?: string;
      systemPrompt?: string;
      systemPromptOptions?: {
        skills?: { name?: string }[];
        cwd?: string;
      };
    };
    const skills = e.systemPromptOptions?.skills ?? [];
    const cwd = e.systemPromptOptions?.cwd || process.cwd();
    const prompt = (e.prompt ?? "").slice(0, 200);
    if (skills.length) {
      logEvent("skill_trigger", {
        skills: skills.map((s) => s.name).filter(Boolean),
        cwd,
        prompt,
      });
    }

    // v2.1 配置快照: systemPrompt全文(截断8k) + 技能集 + 活跃工具集
    const sp2 = e.systemPrompt ?? "";
    const selectedTools = (e.systemPromptOptions as { selectedTools?: unknown } | undefined)?.selectedTools;
    logEvent("config_snapshot", {
      cwd,
      system_prompt: sp2.slice(0, 8000),
      skills_loaded: skills.map((s) => s.name).filter(Boolean),
      selected_tools: Array.isArray(selectedTools) ? selectedTools : undefined,
    });

    // 真启停: 从系统提示中剔除禁用技能的 <skill> 条目
    let disabled: string[] = [];
    try { disabled = JSON.parse(readFileSync(join(homedir(), ".harness-manager", "disabled-skills.json"), "utf-8")).skills ?? []; } catch {}
    let sp = e.systemPrompt;
    if (disabled.length && sp && sp.includes("<available_skills>")) {
      for (const name of disabled) {
        // 匹配 <skill ...name="xxx"...</skill> 单条块
        const re = new RegExp(`\\n?<skill[^>]*name="${name}"[\\s\\S]*?</skill>`, "gi");
        sp = sp.replace(re, "");
      }
    }
    return sp !== e.systemPrompt ? { systemPrompt: sp } : undefined;
  });

  // 实时思考/回复流(P5: 开启会话实时观测 agent 思考与推理链)
  safeOn("message_end", async (event) => {
    const e = event as {
      message?: { role?: string; content?: { type?: string; thinking?: string; text?: string; name?: string; arguments?: unknown }[] };
    };
    const msg = e.message;
    if (!msg || msg.role !== "assistant") return undefined;
    const content = Array.isArray(msg.content) ? msg.content : [];
    const thinking = content.filter((c) => c.type === "thinking").map((c) => c.thinking ?? "").join("\n");
    const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    const tools = content.filter((c) => c.type === "toolCall").map((c) => ({ name: c.name, input: (c.arguments ?? c.input) }));
    logEvent("assistant_message", {
      thinking: thinking.slice(0, 4000),
      text: text.slice(0, 2000),
      tools,
    });
    return undefined;
  });
}
