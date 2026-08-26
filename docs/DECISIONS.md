# DECISIONS —— 去重 / 归属决策记录

> 本文件记录**人工拍板**的结论（Catalog 的一部分，随仓库分发）。
> 格式：`- [日期] <技能> -> <状态>（理由）`
> 状态：`active` / `duplicate-of:<name>` / `superseded-by:<name>` / `candidate`

## 已确认决策

（以下为**建议拍板**，经比对双方描述后给出；待你确认后转正为最终决策。
确认后可用 `./scripts/apply.sh enable|disable <skill>` 落账，并更新 INDEX 状态。）

- [ ] **[建议]** G1：`diagnosing-bugs` (mattpocock) 胜出 → `systematic-debugging` 标 `superseded-by:diagnosing-bugs`
  - 理由：两者同为假设驱动 bug 诊断循环，mattpocock 版描述更完整（含“/diagnose”触发），且已在 `~/.agents/skills` 加载顺序更优先
- [ ] **[建议]** G2：`tdd` (mattpocock) 胜出 → `test-driven-development` 标 `superseded-by:tdd`
  - 理由：功能等价；`tdd` 位于 `~/.agents/skills`，先找到的赢，无需额外操作
- [ ] **[建议]** G3：`grilling` 为主用 → `grill-me` / `grill-with-docs` 标 `duplicate-of:grilling`
  - 理由：同族三件，`grilling` 描述最完整；`grill-me` 仅转发。保留 `grill-with-docs` 作“需要产出文档”时的变体
- [ ] **[建议]** G4：`code-review` 为主用 → `review` 标 `duplicate-of:code-review`
  - 理由：`code-review` 功能更全（双轴 + 并行子代理）；`review` 仅针对 claude.md 约定，功能子集
- [ ] **[建议]** G5：两者**各留**（非重复）
  - 理由：`scaffold`（pi-superpowers）建项目结构 vs `scaffold-exercises`（mattpocock）建练习脚手架，场景不同
- [ ] **[建议]** G6：流程链保留，各自定位：`to-spec`/`to-tickets`（需求→规格/工单）→ `implement`/`implement-spec`（实现）；`loop-me` 作打磨工具
  - 理由：非重复，属同一工作流的先后阶段
- [ ] **[建议]** G7：忽略（聚类噪声）
  - 理由：`setup-pre-commit`/`migrate-to-shoehorn` 是配置/迁移工具，与 TDD 无关，仅因描述含“test”被聚类

## 候选重复组（待拍板）

> 以下来自 `./scripts/scan.sh` 的自动检测（按描述关键词聚类），需人工确认。

| 组 | 候选成员 | 关键词 | 建议 |
|---|---|---|---|
| G1 | `diagnosing-bugs` (mattpocock) vs `systematic-debugging` (pi-superpowers) | debug | 功能重叠，建议二选一 |
| G2 | `tdd` (mattpocock) vs `test-driven-development` (pi-superpowers) | test | 功能重叠，建议二选一 |
| G3 | `grill-me` / `grill-with-docs` / `grilling` (+ `wayfinder`, `to-tickets`) | plan | 同族多件，建议精简 |
| G4 | `code-review` (mattpocock) vs `review` (pi-superpowers) | review | 功能重叠，建议二选一 |
| G5 | `scaffold` (pi-superpowers) vs `scaffold-exercises` (mattpocock) | scaffold | 不同侧重点，可各留 |
| G6 | `implement` / `implement-spec` / `to-spec` / `to-tickets` (+`loop-me`) | spec | 流程链，需理清衔接 |
| G7 | `setup-pre-commit` / `migrate-to-shoehorn` / `grilling` / `tdd` | test | 聚类噪声，忽略或细分 |
| G8 | `hb-ultra/.claude/skills/code-review` vs 全局 `code-review` / `review` | 跨层同名 | 项目级优先，需确认保留哪版 |

## 待办

- [ ] 逐组拍板 G1-G6，用 `./scripts/apply.sh enable|disable <skill>` 落账
- [ ] 拍板后更新 `INDEX.md` 中对应状态
