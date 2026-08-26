# INDEX —— Catalog 总索引

> 本文件是**目录（Catalog）**：全机一致，随仓库分发。
> 记录所有资源的来源、状态、归属（全局/项目）、场景映射。
> **状态取值**：`active` / `duplicate-of:<name>` / `superseded-by:<name>` / `candidate`。
> 机器间差异（装了没装）见各机 `STATUS-<host>.md`（Inventory），不在此文件。

_最后更新: 2026-08-26_

---

## 1. 全局 vs 项目 判定规则

> **默认全局**；仅当能力**只对特定项目 / 项目类型有价值**时才放项目。
> 项目级资源只在被信任的项目里加载——误放项目 = 静默不可用。

## 2. 同名冲突与加载顺序

> pi 同名技能**先找到的赢**。加载顺序：
> `~/.pi/agent/skills` → `~/.agents/skills` → 包 → settings。
> 同名资源必须在下面记录"实际生效者"。

## 3. 技能清单

### 3.1 来源：~/.agents/skills（全局，含 mattpocock 全家桶）

| 技能 | 来源 | 状态 | 归属 | 场景 |
|---|---|---|---|---|
| `grilling` / `grill-me` / `grill-with-docs` | mattpocock | candidate | 全局 | 设计/计划压力测试 |
| `code-review` | mattpocock | candidate | 全局 | review 分支/PR |
| `codebase-design` | mattpocock | active | 全局 | 模块/接口设计 |
| `diagnosing-bugs` | mattpocock | candidate | 全局 | 诊断 bug/性能 |
| `domain-modeling` | mattpocock | active | 全局 | 领域模型/CONTEXT/ADR |
| `prototype` | mattpocock | active | 全局 | 一次性原型验证 |
| `research` | mattpocock | active | 全局 | 查证/资料收集 |
| `resolving-merge-conflicts` | mattpocock | active | 全局 | 解决合并冲突 |
| `scaffold-exercises` | mattpocock | candidate | 全局 | 练习脚手架 |
| `setup-pre-commit` | mattpocock | active | 全局 | pre-commit 配置 |
| `setup-ts-deep-modules` | mattpocock | active | 全局 | TS 深模块 |
| `migrate-to-shoehorn` | mattpocock | active | 全局 | 测试 as→shoehorn |
| `tdd` | mattpocock | candidate | 全局 | TDD |
| `teach` | mattpocock | active | 全局 | 教学 |
| `to-questionnaire` / `to-spec` / `to-tickets` | mattpocock | active | 全局 | 需求→问卷/规格/工单 |
| `implement` / `implement-spec` | mattpocock | active | 全局 | 实现 |
| `triage` | mattpocock | active | 全局 | 问题分类 |
| `wait-what` | mattpocock | active | 全局 | 澄清需求 |
| `wayfinder` | mattpocock | active | 全局 | 方向探索 |
| `wizard` | mattpocock | active | 全局 | 交互式向导 |
| `writing-for-agents` | mattpocock | active | 全局 | 面向 agent 写作 |
| `writing-beats` / `writing-fragments` / `writing-shape` | mattpocock | active | 全局 | 写作 |
| `handoff` / `retro` / `loop-me` | mattpocock | active | 全局 | 交接/回顾/循环 |
| `ask-matt` | mattpocock | active | 全局 | 咨询 |
| `git-guardrails-claude-code` | mattpocock | active | 全局 | git 安全钩子 |
| `claude-handoff` | mattpocock | active | 全局 | 交接 Claude Code |
| `find-skills` | vercel-labs | active | 全局 | 发现/安装技能 |
| `improve-codebase-architecture` | mattpocock | active | 全局 | 架构改进 |

### 3.2 来源：包 pi-superpowers（全局，随包走）

| 技能 | 来源 | 状态 | 归属 | 场景 |
|---|---|---|---|---|
| `using-superpowers` | pi-superpowers | active | 全局 | 会话启动引导 |
| `brainstorming` | pi-superpowers | active | 全局 | 需求头脑风暴 |
| `brief` | pi-superpowers | active | 全局 | 项目简报 |
| `changes` / `commit` / `rollback` | pi-superpowers | active | 全局 | 会话记录/提交/回滚 |
| `debt` | pi-superpowers | active | 全局 | 技术债审计 |
| `dependencies` | pi-superpowers | active | 全局 | 依赖地图 |
| `log` / `nextsteps` | pi-superpowers | active | 全局 | 构建计划日志/下一步 |
| `optimise` | pi-superpowers | active | 全局 | 优化扫描 |
| `restart` / `wrapup` | pi-superpowers | active | 全局 | 恢复会话/收尾 |
| `review` | pi-superpowers | candidate | 全局 | review |
| `rules` | pi-superpowers | active | 全局 | 项目规则 |
| `scaffold` | pi-superpowers | candidate | 全局 | 项目脚手架 |
| `security` | pi-superpowers | active | 全局 | 安全审计 |
| `staging` | pi-superpowers | active | 全局 | 部署 staging |
| `status` | pi-superpowers | active | 全局 | 健康快照 |
| `systematic-debugging` | pi-superpowers | candidate | 全局 | 诊断 bug |
| `test-driven-development` | pi-superpowers | candidate | 全局 | TDD |
| `using-git-worktrees` | pi-superpowers | active | 全局 | git worktree |
| `verification-before-completion` | pi-superpowers | active | 全局 | 完成前验证 |
| `writing-plans` | pi-superpowers | active | 全局 | 写计划 |
| `writing-skills` | pi-superpowers | active | 全局 | 写技能 |
| `audit-structure` | pi-superpowers | active | 全局 | 结构审计 |

### 3.3 来源：harness-manager 单源（本仓库）

| 技能 | 来源 | 状态 | 归属 | 场景 |
|---|---|---|---|---|
| `manage-skills` | harness-manager | active | 全局 | 资源管理 |

### 3.4 项目级资源

| 项目 | 资源 | 位置 | 状态 |
|---|---|---|---|
| `hb-ultra` | `.pi/skills/`、`.claude/skills/`、CLAUDE.md | `C:/working/rzx_project/hb-ultra` | active |
| `pi-harness` | 仅 `pi` 文件 | `C:/working/owner_project/pi-harness` | 待盘 |
| `deepseek-harness` | 空 | `C:/working/owner_project/deepseek-harness` | 待盘 |

---

## 4. 场景 → 技能映射（初稿，待完善）

| 场景 | 推荐技能 | 备选 / 相关 |
|---|---|---|
| review 分支/PR | `code-review` | `review` |
| 诊断 bug/性能 | `diagnosing-bugs` | `systematic-debugging` |
| TDD / 测试驱动 | `tdd` | `test-driven-development` |
| 设计/计划压力测试 | `grilling` | `grill-me`、`grill-with-docs` |
| 项目脚手架 | `scaffold` | `scaffold-exercises` |
| 写计划 | `writing-plans` | — |
| 需求澄清 | `wait-what`、`to-questionnaire` | — |
| 需求→规格/工单 | `to-spec`、`to-tickets` | — |
| 头脑风暴 | `brainstorming` | `grilling` |
| 领域建模 | `domain-modeling` | — |
| 技术债审计 | `debt` | `optimise` |
| 安全审计 | `security` | — |
| 部署 staging | `staging` | — |
| 完成前验证 | `verification-before-completion` | — |
| 资源管理 | `manage-skills` | — |

> 说明：上述 `candidate` 状态 = 待拍板。拍板后移入 `DECISIONS.md` 并更新状态。

## 5. 待办

- [ ] 对 3.1/3.2 的 candidate 逐个拍板，写入 DECISIONS.md
- [ ] 确认每个技能是否要在 Claude Code 侧接线（~/.claude/skills 引用）
- [ ] 决定是否将存活技能物理迁入本仓库 `skills/`
- [ ] 记录 Claude Code 侧（~/.claude/skills）7 个技能的去重关系
