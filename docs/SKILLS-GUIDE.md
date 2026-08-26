# Skills 全量中文分类指南

> 按使用场景把所有技能分为 8 类，每个技能一句中文说明 + 何时使用。
> 让"什么场景用什么技能"一屏看清。

## 📋 一、需求与规划（需求雷达 / 前期）
| 技能 | 中文说明 | 何时用 |
|---|---|---|
| `grilling` | 连环追问，把方案/计划逼问清楚 | 动手前验证设计 |
| `grill-me` | 拷问入口（转发 grilling） | 想被拷问设计 |
| `grill-with-docs` | 拷问同时产文档（ADR/术语表） | 边设计边留档 |
| `loop-me` | 针对"要建的流程"反复拷问规格 | 模糊想法→清晰需求 |
| `wait-what` | 停下重讲："刚才那句没说清" | 需求含糊时 |
| `to-questionnaire` | 决策变问卷给别人填 | 需求要问别人 |
| `wayfinder` | 超大工程拆成决策地图 | 大项目规划 |
| `brainstorming` | 开放式头脑风暴 | 从零想做什么 |
| `triage` | 问题/PR 分诊，写简报 | 一堆 issue 理优先级 |

## 🎨 二、设计与架构
| 技能 | 中文说明 | 何时用 |
|---|---|---|
| `codebase-design` | 设计深模块/接口/可测性 | 设计重构模块 |
| `domain-modeling` | 领域模型 + CONTEXT/ADR | 建立领域词汇 |
| `improve-codebase-architecture` | 架构体检 + HTML 报告 | 架构评估 |
| `prototype` | 一次性原型验证 | 不确定先试 |
| `to-spec` | 对话转技术规格 | 出规格 |
| `to-tickets` | 计划/规格拆工单 | 拆任务 |
| `implement-spec` / `implement` | 按规格/工单实现 | 正式写码 |

## 💻 三、开发与编码
| 技能 | 中文说明 | 何时用 |
|---|---|---|
| `tdd` | 测试驱动开发（红绿重构） | 先测试后代码 |
| `test-driven-development` | 同上（备选版） | 同上 |
| `scaffold` | 生成项目结构 | 新项目起步 |
| `scaffold-exercises` | 建练习题结构 | 做课程 |
| `setup-ts-deep-modules` | TS 深模块配置 | TS 架构落地 |
| `setup-pre-commit` | Husky pre-commit 钩子 | 加提交钩子 |
| `migrate-to-shoehorn` | as 断言改 shoehorn | 测试重构 |
| `using-git-worktrees` | git worktree 隔离实验 | 安全搞实验 |
| `resolving-merge-conflicts` | 解决合并冲突 | merge 冲突 |

## 🔍 四、质量与调试
| 技能 | 中文说明 | 何时用 |
|---|---|---|
| `code-review` | 双轴代码审查 | 审查 PR |
| `review` | 结构化代码审查 | 快速 review |
| `diagnosing-bugs` | 硬 bug 诊断循环 | 出 bug |
| `systematic-debugging` | 假设驱动调试 | 疑难 bug |
| `verification-before-completion` | 完成前验证 | 收尾前 |
| `security` | 安全审计 | 安全检查 |
| `audit-structure` | 结构审计 | 一致性检查 |
| `debt` | 技术债审计 | 债盘点 |
| `optimise` | 优化扫描 | 代码清理 |

## 📊 五、项目管理与进度
| 技能 | 中文说明 | 何时用 |
|---|---|---|
| `status` | 项目健康快照 | 中途了解现状 |
| `brief` | 一页项目简报 | 新人/回顾 |
| `log` | 构建状态写 buildplan | 更新进度 |
| `nextsteps` | 推导下一步 3-5 件事 | 想下一步 |
| `changes` | 会话改动记录 | 记录变更 |
| `staging` | 部署 staging | 发布前 |
| `rollback` | 安全回滚 | 出错要撤 |
| `restart` | 恢复上次会话 | 新会话续接 |
| `wrapup` | 会话收尾 | 结束一天 |

## 🤝 六、协作与交接
| 技能 | 中文说明 | 何时用 |
|---|---|---|
| `handoff` | 对话压成交接文档 | 换 agent |
| `claude-handoff` | 交接给 Claude Code | 跨工具交接 |
| `retro` | 编码会话回顾 | 回顾会 |
| `dispatching-parallel-agents` | 并行分发子任务 | 任务可并行 |
| `teach` | 教你新技能 | 想学习 |
| `ask-matt` | 技能路由器（用哪个） | 不确定用啥 |
| `wizard` | 交互式 bash 向导 | 人工步骤向导 |

## 📞 七、沟通与写作
| 技能 | 中文说明 | 何时用 |
|---|---|---|
| `writing-for-agents` | 面向 agent 写作 | 写 AGENTS.md |
| `writing-plans` | 写多步计划 | 复杂改动 |
| `writing-skills` | 编技能 | 造 skill |
| `writing-beats`/`writing-fragments`/`writing-shape` | 写作（节奏/片段/结构） | 创作写作 |

## 🛠 八、系统工具与自管理
| 技能 | 中文说明 | 何时用 |
|---|---|---|
| `find-skills` | 发现/安装技能 | 找技能 |
| `manage-skills` | 资源管理（本项目核心） | 资源管理 |
| `setup-matt-pocock-skills` | 配置技能套件 | 首次安装 |
| `git-guardrails-claude-code` | git 安全钩子 | 防危险命令 |
| `using-superpowers` | 套件引导 | 会话启动 |
| `run-tasks`/`run-all-tasks`/`task-status` | 任务批量执行/状态 | 批量任务 |
| `cost`/`learned`/`memory`/`resume` | 成本/学习/记忆/续接 | CC 会话管理 |

## 📌 使用建议
1. **不确定用哪个** → `ask-matt`（技能路由器）
2. **动手前** → `grilling`/`brainstorming` 想清楚
3. **写代码** → `tdd` → `implement` → `code-review`
4. **出 bug** → `diagnosing-bugs`/`systematic-debugging`
5. **收尾** → `verification-before-completion` → `wrapup`
