# 技术规格 —— harness-manager 跨 Agent 资源管理系统

> 生成方式: 依据设计讨论（Q1-Q26）与 `docs/DESIGN.md` 综合而成
> 版本: v1.0-spec
> 状态: 待评审（`ready-for-agent`）
> 发布载体: 仓库内 `docs/SPEC.md`（gh CLI 不可用且未配置 issue tracker，故以仓库内文档作为规格载体；待配置 tracker 后可迁移）

---

## Problem Statement

用户同时使用 **pi、Claude Code、Codex** 等多个 AI agent 工具，各自的 skills、扩展、工具、会话、调用轨迹分散在不同目录、不同格式、不同机器上。由此产生四类问题：

1. **资源冗余**：技能/工具过多，功能重复或冲突，无人统一盘点与消歧
2. **归属不清**：某能力该放全局、项目还是跨 harness 共用，缺乏可判定规则与执行手段
3. **共享困难**：多项目、多服务器、多用户之间无法快速复用同一套资源与决策
4. **会话与调用链黑盒**：会话无法统一检索；工具调用轨迹不可视；token/上下文/记忆无全局视图，排查问题困难

用户需要一个**通过系统安装方式部署的外部插件 + 可视化控制面**，跨 pi / Claude Code / Codex 统一管理上述对象。

## Solution

构建 **harness-manager**：一个可分发（git/npm/本地路径）的**本地服务 + Web 控制面 + CLI** 三位一体系统。

- **数据模型层**统一三端差异（Resource / Session / CallTrace / ToolCall / Memory / TokenUsage）
- **适配器层**分别对接 pi、Claude Code、Codex，读取会话/配置/资源文件，并订阅实时事件（pi extension hook）
- **分析层**重建调用链树、聚合 token、检测去重候选、检索记忆、汇总多机 fleet
- **管理操作层**所有写操作走 dry-run → 确认 → 执行
- **Web 控制面**提供仪表盘、技能管理、会话与调用链、记忆/规范、多机视图
- **CLI** 作为同等能力的命令行入口
- 与既有 `harness-manager` 仓库（skills/ 单源、docs/ 目录与决策、scripts/ scan/apply/fleet）**集成**：Web 展示的就是同一份 Catalog/Inventory，管理操作复用 apply 的 dry-run 语义

## User Stories

1. 作为用户，我想安装一个包/脚本就能在任意机器启动管理服务，以便多服务器/多用户快速复用。
2. 作为用户，我想在一个 Web 页面看到 pi / Claude Code / Codex 的 skills、扩展、工具清单，以便统一盘点。
3. 作为用户，我想看到每个资源来自哪个 harness、哪个目录、是全局/项目/包级，以便判断归属。
4. 作为用户，我想自动得到"同名重复"和"功能重叠"的候选列表，以便发现冗余。
5. 作为用户，我想对候选重复拍板（保留/合并/废弃），并让决策落账可追溯，以便长期维护。
6. 作为用户，我想按"场景→技能"反向查询该用什么技能，以便避免选错。
7. 作为用户，我想把某个技能标记为跨 pi 与 Claude Code 共用（单源 + 两端引用），以便改一处两端生效。
8. 作为用户，我想在页面启停/迁移某个技能或工具组（先看 dry-run 再确认），以便受控变更。
9. 作为用户，我想查看某项目（如 hb-ultra）的项目级 skills 与全局的关系，以便处理跨层同名冲突。
10. 作为用户，我想列出 pi / Claude Code / Codex 的全部会话（时间/项目/模型/token/消息数），以便管理会话。
11. 作为用户，我想按内容/项目/时间检索会话，以便快速找到历史工作。
12. 作为用户，我想看到某次会话的调用链树（toolName/input/output/时长/父子关系），以便理解执行轨迹。
13. 作为用户，我想在调用链中定位慢调用、错误、重试，以便排查性能与故障。
14. 作为用户，我想按 token 成本/时长排序工具调用，以便发现成本与效率瓶颈。
15. 作为用户，我想看到 token 用量按会话/项目/工具/模型的聚合，以便预算与优化。
16. 作为用户，我想看到上下文规模趋势与压缩点（compaction），以便判断是否过长。
17. 作为用户，我想统一查看 AGENTS.md / CLAUDE.md / memory.md / plans 等记忆与规范文件，以便长期记忆可管理。
18. 作为用户，我想从现有规范生成模板并应用到新项目，以便快速初始化项目规范。
19. 作为用户，我想汇总多台机器的 inventory 并在一个视图对比差异，以便多机一致性与排障。
20. 作为用户，我想让所有写操作都有 dry-run 预览和显式确认，以便不误改配置。
21. 作为用户，我想系统不触碰 trust/密钥/权限等安全级配置，以便安全底线不被破坏。
22. 作为用户，我想系统能增量采集避免重复读大文件，以便性能可接受。
23. 作为用户，我想系统跨 Windows/macOS/Linux 运行，以便任意环境可用。
24. 作为用户，我想新接入一种 agent 工具只需新增一个适配器，以便可扩展。

## Implementation Decisions

- **技术栈**：Node.js + TypeScript。理由：与 pi 同栈（`@earendil-works/pi-coding-agent` 提供 extension API/类型）；三端会话均为 JSON(L)，解析友好；可打包为 CLI 与 daemon。
- **进程形态**：`hm serve`（常驻 daemon，本地 HTTP + WS）与 `hm` 子命令（`scan/list/trace/token/memory/fleet`）共用同一核心，双入口。
- **统一 Schema（来自原型思考，决策核心）**：
  ```ts
  interface HarnessResource { id; name; kind: 'skill'|'tool'|'extension'|'project-skill';
    source: 'pi'|'claude'|'codex'|'package'|'single-source'|'project';
    scope: 'global'|'project'|'package'; path; status: 'active'|'candidate'|'duplicate-of'|'superseded-by';
    harnesses: ('pi'|'claude'|'codex')[]; description; scene?: string; }
  interface Session { id; harness; cwd; startedAt; model; messages: number;
    tokenUsage?: { input; output; total }; tools: ToolCall[]; }
  interface ToolCall { id; parentId?; name; input; output?; startedAt; endedAt?; durationMs?;
    tokens?: number; error?: string; }
  interface MemoryFile { id; kind: 'AGENTS.md'|'CLAUDE.md'|'memory.md'|'plan'|'other';
    path; content; updatedAt; }
  ```
- **适配器契约**：每个 harness 实现 `readResources(): Resource[]`、`readSessions(): Session[]`、`watch(cb): () => void`、`applyMutation(mut, ctx)`。pi 用 `pi.on("session_start"/"tool_call")` 订阅实时事件；CC 用文件增量 + 可选 hook；Codex 预留（当前无数据）。
- **调用链重建**：pi 会话用 `parentId` 树、CC 用 `tool_use` 事件按 id/parent 关联，聚合成树。
- **管理操作**：`apply` 统一为 `{dryRun: true} → {confirmed: true} → commit`，复用现有 `scripts/apply.sh` 语义。
- **与既有资产集成**：Catalog = `docs/INDEX.md` + `docs/DECISIONS.md`；Inventory = `docs/STATUS-<host>.md`；Web 与 CLI 读同一数据模型，不另起炉灶。
- **存储**：采集结果落 `~/.harness-manager/`（缓存/索引/配置），原始文件只读。
- **配置**：`~/.harness-manager/config.json`（监听端口、启用 harness、扫描间隔、SSH fleet 配置）。

## Testing Decisions

- **好测试的定义**：只测外部可观察行为——给定一段会话 JSONL（fixture），适配器必须还原出正确的 Session/ToolCall 树；给定资源目录结构，必须产出正确的 Resource 列表与去重候选。
- **被测模块**：三端适配器（pi/CC/Codex 解析）、调用链重建、token 聚合、去重候选生成。
- **测试形态**：用真实会话文件的脱敏样本作为 fixture，快照比对解析结果。
- **先例**：本仓库目前无测试基建；建议引入 vitest（与 TS 同栈）。管理操作测试覆盖 dry-run 不落盘、确认后落盘。

## Out of Scope

- 不自动修改 trust / 密钥 / 权限等安全级配置（仅只读查看或显式确认）
- 不替换各 harness 自带的会话/记忆存储（只读分析 + 受控归档）
- 不做云端/多用户账户体系（多机通过 ssh fleet 只读汇总）
- 不实现完整插件市场/在线商店（资源分发走 git/npm 包）
- 不实现实时协作编辑

## Further Notes

- 三端数据面已核实：pi `sessions/*.jsonl`（含 `toolCallId`/`parentId`）、CC `projects/*.jsonl`（含 `tool_use`）、Codex `~/.codex`（当前空）。
- 当前 `hb-ultra` 项目已暴露"项目级 code-review vs 全局 code-review"的跨层重叠案例，可作为首个去重决策的真实测试用例。
- 里程碑建议：M1 数据层+CLI → M2 分析层 → M3 Web 只读 → M4 写操作 → M5 多机。
- 待拍板：Q23 形态 / Q24 读取 / Q25 记忆语义 / Q26 边界（本轮已基本对齐：本地 Web + 文件读取 + hook、长期+短期记忆、M1 起步建议）。
