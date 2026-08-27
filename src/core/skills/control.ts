/**
 * 技能真启停控制
 *
 * 禁用名单写入 ~/.harness-manager/disabled-skills.json，
 * pi extension 在 resources_discover / before_agent_start 时读取，
 * 过滤掉已禁用技能（真正不进 agent 上下文，而非仅标记）。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const DISABLED_FILE = join(homedir(), ".harness-manager", "disabled-skills.json");

interface DisabledState {
  skills: string[]; // 禁用的技能名
  updatedAt: string;
}

function loadDisabled(): DisabledState {
  if (!existsSync(DISABLED_FILE)) return { skills: [], updatedAt: "" };
  try {
    return JSON.parse(readFileSync(DISABLED_FILE, "utf-8"));
  } catch {
    return { skills: [], updatedAt: "" };
  }
}

function saveDisabled(s: DisabledState): void {
  s.updatedAt = new Date().toISOString();
  mkdirSync(join(homedir(), ".harness-manager"), { recursive: true });
  writeFileSync(DISABLED_FILE, JSON.stringify(s, null, 2));
}

export function isDisabled(name: string): boolean {
  return loadDisabled().skills.includes(name);
}

/** 启用/禁用一个技能（返回生效后的名单） */
export function setSkillEnabled(name: string, enabled: boolean): string[] {
  const st = loadDisabled();
  const set = new Set(st.skills);
  if (enabled) set.delete(name);
  else set.add(name);
  saveDisabled({ skills: [...set], updatedAt: "" });
  return [...set];
}

/** 全部禁用名单（给 extension 读） */
export function getDisabledSkills(): string[] {
  return loadDisabled().skills;
}
