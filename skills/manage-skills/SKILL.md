---
name: manage-skills
description: 管理 pi / harness 资源（skills、扩展、工具、项目级资源）的全局 vs 项目划分、去重/冲突消解、跨 harness（pi 与 Claude Code）共享、以及多机复用。当需要盘点、清理、迁移、归类、消解重复或决定某个资源归属时使用。
---

# manage-skills —— harness 资源管理

本技能是 harness-manager 的核心操作入口。它封装了"如何做决策、如何操作"的规则，
并指引你使用仓库里的脚本与文档。**管理对象**：skills、扩展、自定义工具、项目级资源。

## 何时使用

- 技能/扩展/工具太多，出现重复或冲突
- 决定某个能力该放全局还是项目
- 跨 harness（pi 与 Claude Code）共用某个技能
- 新机器 / 新用户部署这套管理
- 需要盘点现状、生成清单或执行迁移

## 核心规则

### R1 全局 vs 项目
> **默认全局**；仅当能力**只对特定项目 / 项目类型有价值**时才放项目。
> 项目级资源只在被信任的项目里加载——误放项目 = 静默不可用。

### R2 跨 harness 共享
> 技能**单源**存放（harness-manager 的 `skills/`），pi 与 Claude Code 都**引用同一路径**。
> 改一处，两端生效。不要各端各存一份副本。
> 接线：
> - pi 侧：仓库作为包安装（`pi install git:...` 或本地路径）
> - Claude Code 侧：在 `~/.claude/settings.json` 的 `skills` 数组加入单源目录引用
> - 项目级：在项目 `.pi/skills` / `.claude/skills` 放项目专属技能（只在信任项目内生效）

### R3 去重判定
- **同名** = 重复（机器可判定：扫描各来源取交集）
- **功能重叠** = 候选（按名称相似度 + 描述关键词），人工拍板
- 判定结果写入 `docs/DECISIONS.md`，状态标记为：
  - `active` 使用中
  - `duplicate-of:<name>` 重复于某技能
  - `superseded-by:<name>` 被某技能取代
  - `candidate` 候选重复，待拍板
- **包自带技能**：随包走（靠 `pi update` 升级），但**参与去重判定**。

### R4 同名冲突（加载顺序）
> pi 同名技能**先找到的赢**。加载顺序：`~/.pi/agent/skills` → `~/.agents/skills` → 包 → settings。
> 索引必须记录每个同名资源的加载顺序与生效者，避免踩坑。

### R5 多机边界
- **目录（Catalog）**：技能内容、扩展、决策状态、场景映射 —— 全机一致，进仓库
- **清单（Inventory）**：每台机器实际装了什么 —— 各机本地 `STATUS-<host>.md`
- **变更**：只在各机本地执行，`apply.sh` 默认 dry-run，人工确认后生效
- **远程**：只做只读 fleet 汇总，不自动改任何远程配置

## 操作流程

### 流程 1：盘点现状
```bash
./scripts/scan.sh
```
生成 `docs/STATUS-<host>.md`（本机快照）+ 候选重复报告。只读，不改任何配置。

### 流程 2：去重 / 归属决策（人工拍板）
1. 查看 scan 报告的候选重复列表
2. 逐个确认：`duplicate-of` / `superseded-by` / `active`，以及归属全局 or 项目
3. 把结论写入 `docs/DECISIONS.md`
4. 更新 `docs/INDEX.md` 对应条目的状态与归属

### 流程 3：执行变更（含 dry-run）
```bash
./scripts/apply.sh --dry-run <command>   # 先看将要改什么
./scripts/apply.sh <command>             # 确认后执行
```
> 永远先 dry-run。脚本不自动写 trust / tool-gate / 本机 settings。

### 流程 4：多机部署
1. 新机器：见 `docs/INSTALL.md`（clone 或 `pi install`）
2. 各机跑 `scan.sh` 生成自己的 `STATUS-<host>.md`
3. 需要全局视图：`./scripts/scan-fleet.sh host1 host2 ...`（只读）

### 流程 5：跨 harness 接线（pi + Claude Code 共用）
1. 确认该技能确实需要双端共用（否则留在单侧）
2. 把技能放入单源 `skills/<name>/`（或确认已在）
3. pi 侧：确认仓库已安装为包（`pi list` 能看到）
4. Claude Code 侧：在 `~/.claude/settings.json` 的 `skills` 数组加入单源目录引用
   （属机器级变更，需人工确认后执行）
5. 验证两端都能加载，更新 `docs/INDEX.md` 3.5 节

### 流程 6：项目级资源盘点
1. 对每个信任项目，盘点其 `.pi/skills` 与 `.claude/skills`
2. 记录到 `docs/INDEX.md` 3.4 节
3. 检查与全局技能的同名/功能重叠（如项目级 code-review vs 全局 code-review）
4. 决策写入 `docs/DECISIONS.md`（项目级默认优先于全局）

## 文档导航

- `docs/INDEX.md` —— Catalog：所有资源 + 场景→技能映射 + 状态/归属
- `docs/DECISIONS.md` —— 去重/归属决策记录
- `docs/INSTALL.md` —— 多机安装/更新/迁移
- `docs/STATUS-<host>.md` —— 各机 Inventory 快照（脚本生成）
