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
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:os";
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
  // 会话开始
  pi.on("session_start", async (event) => {
    logEvent("session_start", {
      reason: (event as { reason?: string }).reason ?? "unknown",
      cwd: (event as { cwd?: string }).cwd ?? "",
    });
  });

  // 会话结束
  pi.on("session_shutdown", async () => {
    logEvent("session_shutdown", {});
  });

  // 工具调用（核心：实时监控）
  pi.on("tool_call", async (event) => {
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
}
