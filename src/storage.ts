/**
 * 存储：采集结果缓存到 ~/.harness-manager/cache.json
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ensureDataDir, dataDir } from "./config.js";
import type { ScanResult } from "./types.js";

export function saveCache(result: ScanResult): void {
  ensureDataDir();
  writeFileSync(join(dataDir(), "cache.json"), JSON.stringify(result, null, 2));
}

export function loadCache(): ScanResult | null {
  const p = join(dataDir(), "cache.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as ScanResult;
  } catch {
    return null;
  }
}
