# DECISIONS —— 去重 / 归属决策记录

> 本文件记录**人工拍板**的结论（Catalog 的一部分，随仓库分发）。
> 格式：`- [日期] <技能> -> <状态>（理由）`
> 状态：`active` / `duplicate-of:<name>` / `superseded-by:<name>` / `candidate`

## 已确认决策

（尚无正式拍板。以下为已识别的**候选重复组**，待逐一确认。）

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

## 待办

- [ ] 逐组拍板 G1-G6，用 `./scripts/apply.sh enable|disable <skill>` 落账
- [ ] 拍板后更新 `INDEX.md` 中对应状态
