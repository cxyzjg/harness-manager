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

## 包技能统一迁移（2026-08-26 第2轮）
- superpowers 包 27 个技能 → 复制进单源目录
- 删除重复/无意义: test-driven-development(重复tdd)、review(重复code-review)、using-superpowers(依赖已删包)
- 空目录清理: learned
- **删除包**: npm:@krone9/pi-superpowers、git:github.com/wuyaos/pi-packages、npm:@narumitw/pi-plan-mode
  （settings.json 备份: ~/.pi/agent/settings.json.bak-20260826183305）
- 最终: 单源 69 个技能统一管理, 项目级(hb-ultra 10个)保留在各自项目下
