/**
 * 快速部署：在新服务器/新用户机器上一键初始化 harness-manager。
 * 每机数据独立，不涉及任何跨机数据同步/汇总。
 *
 * 部署内容:
 *   1) 确保仓库已就位（clone 或已在本机）
 *   2) npm install（装依赖）
 *   3) 生成 ~/.harness-manager/config.json（若不存在）
 *   4) 首次 scan（生成缓存）
 *   5) 提示后续使用方式
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { dataDir, loadConfig } from "./config.js";
import { scan } from "./orchestrator.js";
import { saveCache } from "./storage.js";

export interface DeployResult {
  steps: { step: string; status: "ok" | "skip" | "error"; detail?: string }[];
  dataDir: string;
}

/**
 * 执行部署。
 * @param repoPath 仓库路径（已存在则跳过 clone）
 * @param repoUrl  仓库 URL（repoPath 不存在时用于 clone）
 */
export async function deploy(repoPath: string, repoUrl?: string): Promise<DeployResult> {
  const steps: DeployResult["steps"] = [];
  const dd = dataDir();

  // 1) 仓库
  if (existsSync(repoPath)) {
    steps.push({ step: "仓库已存在", status: "skip", detail: repoPath });
  } else if (repoUrl) {
    try {
      execSync(`git clone ${repoUrl} "${repoPath}"`, { stdio: "pipe", encoding: "utf-8" });
      steps.push({ step: "已克隆仓库", status: "ok", detail: `${repoUrl} → ${repoPath}` });
    } catch (e) {
      steps.push({ step: "克隆仓库", status: "error", detail: (e as Error).message });
      return { steps, dataDir: dd };
    }
  } else {
    steps.push({ step: "仓库", status: "error", detail: `未找到 ${repoPath} 且未提供 repoUrl` });
    return { steps, dataDir: dd };
  }

  // 2) npm install（若 package.json 存在）
  if (existsSync(join(repoPath, "package.json"))) {
    try {
      execSync("npm install --no-audit --no-fund", { cwd: repoPath, stdio: "pipe", encoding: "utf-8" });
      steps.push({ step: "npm install", status: "ok" });
    } catch (e) {
      steps.push({ step: "npm install", status: "error", detail: (e as Error).message });
      return { steps, dataDir: dd };
    }
  } else {
    steps.push({ step: "npm install", status: "skip", detail: "无 package.json" });
  }

  // 3) 数据目录 + 配置
  mkdirSync(dd, { recursive: true });
  const cfgPath = join(dd, "config.json");
  if (!existsSync(cfgPath)) {
    const cfg = loadConfig();
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    steps.push({ step: "生成配置", status: "ok", detail: cfgPath });
  } else {
    steps.push({ step: "配置已存在", status: "skip", detail: cfgPath });
  }

  // 4) 首次扫描
  try {
    const result = await scan();
    saveCache(result);
    steps.push({
      step: "首次扫描",
      status: "ok",
      detail: `${result.resources.length} 资源 / ${result.sessions.length} 会话 / ${result.memories.length} 记忆`,
    });
  } catch (e) {
    steps.push({ step: "首次扫描", status: "error", detail: (e as Error).message });
  }

  return { steps, dataDir: dd };
}
