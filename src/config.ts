/**
 * 配置加载：~/.harness-manager/config.json
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";

export interface Config {
  port: number; // Web 服务端口
  enabledHarnesses: ("pi" | "claude" | "codex")[];
  scanIntervalMs: number; // 采集间隔
  dataDir: string; // 缓存/索引目录
  ssh?: { hosts?: string[]; remoteDir?: string; sshKey?: string }; // fleet
}

export function dataDir(): string {
  return join(homedir(), ".harness-manager");
}

const DEFAULTS: Config = {
  port: 8787,
  enabledHarnesses: ["pi", "claude", "codex"],
  scanIntervalMs: 60_000,
  dataDir: dataDir(),
};

export function loadConfig(): Config {
  const cfgPath = join(dataDir(), "config.json");
  let user: Partial<Config> = {};
  if (existsSync(cfgPath)) {
    try {
      user = JSON.parse(readFileSync(cfgPath, "utf-8")) as Partial<Config>;
    } catch {
      // 损坏配置忽略，用默认
    }
  }
  return { ...DEFAULTS, ...user };
}

export function ensureDataDir(): void {
  mkdirSync(dataDir(), { recursive: true });
}

export function writeConfig(cfg: Config): void {
  ensureDataDir();
  writeFileSync(join(dataDir(), "config.json"), JSON.stringify(cfg, null, 2));
}
