# 技能迁移报告（2026-08-26）

## 目标
将所有技能统一迁移到**单源共享**（`harness-manager/skills/`），同名只保留一个。

## 迁移内容
| 来源 | 数量 | 状态 |
|---|---|---|
| `~/.agents/skills`（mattpocock 等） | 38 | ✅ 已迁入单源，原目录已删除 |
| `~/.claude/skills`（CC 任务类） | 7 | ✅ 已迁入单源，原目录已删除 |
| **合计** | **45** | 全部进入单源 |

## 去重结果
- 45 个单源技能**内部无同名重复**（agents 38 + claude 7 无冲突）
- 唯一同名 `code-review`：单源(全局共享版) vs hb-ultra 项目级(项目专属) — **属"项目覆盖全局"合理模式，保留**

## 未迁移（保留原处）
- hb-ultra 项目级技能：`.claude/skills` 9 个 + `.pi/skills` 1 个（项目专属）
- 第三方包自带技能：superpowers 等 node_modules 里的 27 个（随包升级）
- `manage-skills`（已在单源）

## 原目录处理
✅ 迁移后已删除 `~/.agents/skills` 和 `~/.claude/skills`

## 备份
迁移前已备份到 `/tmp/hm-backup-20260826152736/`（agents-skills + claude-skills）
如需回滚：从备份恢复原目录即可。

## 单源技能如何被加载
harness-manager 已作为 pi 包安装（`pi list` 可见），其 `skills/` 目录是标准加载位置，
pi 自动加载单源内全部技能。Claude Code 侧可通过 settings 引用同一目录（单源多引用）。
