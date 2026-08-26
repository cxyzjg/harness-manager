# 设计与需求说明 —— harness-manager 外部插件 + 可视化控制面

> 版本: v1.0-draft
> 状态: 设计中（待评审）
> 关联: README.md（概述）、docs/INDEX.md（资源目录）、docs/INSTALL.md（部署）

---

## 1. 目的与问题

通过**系统安装**的方式，提供一个**跨 harness 的外部插件 + 可视化页面**，用于**监控和管理**
pi、Claude Code、Codex 等 AI agent 工具的 skills、工具、扩展、会话、以及会话中的**调用轨迹**。

解决四类问题：

1. **资源冗余**：技能过多导致重复/冲突 → 去重、消歧、统一目录
2. **归属不清**：场景→技能归属不清 → 全局/项目/跨 harness 划分与映射
3. **共享复用**：pi / Claude Code / 多项目 / 多服务器 / 多用户共用 → 单源分发 + 多机复用
4. **会话与调用链**：会话管理、调用链路调试、问题排查 → 可视化调用轨迹、token/上下文/记忆监控

## 2. 范围

### 管理对象（数据面）

| 对象 | 来源 | 可读性 | 说明 |
|---|---|---|---|
| Skills | pi / CC / Codex 各目录 + 本项目单源 | ✅ 文件 | 含项目级、包级、全局 |
| 工具（工具门禁） | `tool-gate.json` | ✅ 文件 | 启停/分组/项目授权 |
| 扩展 | pi 包、CC 插件 | ✅ 文件 | 注册的能力 |
| 会话 | pi `sessions/*.jsonl`、CC `projects/*.jsonl` | ✅ 文件 | 事件流 |
| 调用轨迹 | 会话中的 `toolName`/`toolCallId`/`parentId`/`tool_use` | ✅ 可解析 | 调用链树 |
| Token | 会话中的 model/token 事件（pi）、CC 的 cost/usage | ◐ 部分 | 需统一口径 |
| 上下文 | 会话消息序列、compaction | ◐ 部分 | 规模估算 |
| 记忆/项目规范 | `AGENTS.md`/`CLAUDE.md`/`memory.md`/`plans/` | ✅ 文件 | 长期 + 短期 |
| 多机 | 各机 inventory | ✅ 文件 | fleet 汇总 |

### 不管理（边界）
- 不自动修改各 harness 的**安全级配置**（trust、权限、密钥）——只读或需显式确认
- 不替换各 harness 的会话/记忆存储（只读分析 + 受控管理）

## 3. 架构

```
┌─────────────────────────────────────────────────────┐
│  Web 控制面 (localhost, 可视化页面)                    │
│  - 仪表盘: 资源总览 / token / 会话 / 调用链            │
│  - 技能管理: 去重候选 / 全局-项目归属 / 启停            │
│  - 会话与调用链: 轨迹图 / 调试 / 检索                  │
│  - 记忆/规范: 查看/编辑/模板化                         │
│  - 多机: fleet 汇总视图                               │
└──────────────┬──────────────────────────────────────┘
               │ HTTP/WS
┌──────────────▼──────────────────────────────────────┐
│  harness-manager 核心服务 (本地 daemon / CLI)          │
│  - 数据模型层 (统一 Schema)                           │
│  - 适配器层: piAdapter / ccAdapter / codexAdapter     │
│  - 采集层: 文件读取 + 实时事件订阅(pi extension)       │
│  - 分析层: 调用链重建 / token统计 / 去重检测 / 记忆检索 │
│  - 管理操作层: 启停/迁移/接线 (dry-run + 确认)         │
└──────────────┬──────────────────────────────────────┘
               │ 读/写
┌──────────────▼──────────────────────────────────────┐
│  数据源 (各 harness 本地)                             │
│  pi: sessions/ settings/ tool-gate/ skills/ packages │
│  cc: projects/ sessions/ plans/ memory/ skills       │
│  codex: config/ sessions (当前为空)                   │
│  本项目: skills/ extensions/ docs/ scripts/          │
└─────────────────────────────────────────────────────┘
```

### 分层

- **数据模型层**：统一 Schema（Resource/Session/CallTrace/ToolCall/Memory/TokenUsage），
  屏蔽三端差异
- **适配器层**：每端一个 adapter，负责"读文件 / 订阅事件 / 转换为统一模型"
- **采集层**：定时扫描文件 + 实时事件订阅（pi 用 `pi.on("tool_call")` 等；CC/Codex 用文件增量 + 可选 hook）
- **分析层**：调用链树重建、token 聚合、去重候选、记忆检索、fleet 汇总
- **管理操作层**：所有写操作走"dry-run → 确认 → 执行"，写各 harness 配置/目录
- **服务/展示层**：本地 HTTP 服务 + Web 前端；CLI 作为同等入口

### 适配器策略

| harness | 历史读取 | 实时事件 | 备注 |
|---|---|---|---|
| pi | `sessions/*.jsonl` 解析 | `pi.on(...)` extension | 事件最丰富 |
| Claude Code | `projects/*.jsonl` 解析 + `plans/`/`memory` | 文件增量 / hook | 原生会话格式 |
| Codex | `~/.codex` 会话 | — | 当前无数据，预留 |

## 4. 功能需求

### FR-1 资源管理（skills/工具/扩展）
- 跨三端盘点 skills、工具、扩展，生成统一目录
- 去重候选（同名 + 功能重叠），人工拍板，记录决策
- 全局/项目/跨 harness 归属划分与迁移
- 工具门禁查看（只读），启停操作（dry-run + 确认）
- 跨 harness 接线指引（单源技能在 pi/CC 两端引用）

### FR-2 会话管理
- 列出三端会话（时间/项目/模型/token/消息数）
- 会话检索（按内容/项目/时间）
- 会话归档、清理预览（只读统计，清理需确认）

### FR-3 调用链轨迹
- 从会话重建调用链树（toolName/input/output/时长/父子关系）
- 可视化轨迹图（时间线 + 树状）
- 调试：定位某次工具调用、错误、重试、慢调用
- 按 token 成本 / 时长排序定位瓶颈

### FR-4 上下文/Token/记忆
- token 用量聚合（按会话/项目/工具/模型）
- 上下文规模估算（消息数/token 趋势、compaction 点）
- 记忆与项目规范统一视图（AGENTS.md/CLAUDE.md/memory.md/plans）
- 模板化：从现有规范生成模板，应用到新项目

### FR-5 多机 fleet
- 各机 inventory 汇总
- 全局资源视图（哪些机装了哪些技能/扩展）
- 差异对比（A 机与 B 机的配置差异）

### FR-6 可视化页面
- 仪表盘（资源/会话/token 总览）
- 技能管理页（去重候选、归属、启停）
- 会话与调用链页（轨迹图、调试）
- 记忆/规范页
- 多机视图

### FR-7 安装与分发
- `pi install git:...` 安装插件本体
- 独立安装脚本（支持非 pi 环境 / 其他 harness）
- 一键启动服务 / CLI
- 多机部署与更新

## 5. 非功能需求

- **安全**：只读为主；所有写操作 dry-run + 显式确认；不触碰 trust/密钥/权限
- **可扩展**：新 harness 只需新增一个 adapter
- **可观测**：自身日志、采集健康检查
- **性能**：增量采集，避免全量重读大会话
- **跨平台**：Windows/macOS/Linux（当前开发环境 Windows）

## 6. 里程碑（建议）

- **M1 数据层**：三端 adapter 读全数据，统一 Schema，CLI 查询
- **M2 分析层**：调用链重建、token 统计、去重检测、记忆检索
- **M3 服务与 Web**：本地 HTTP + 可视化页面（只读展示）
- **M4 管理操作**：写操作（启停/迁移/接线/清理）dry-run + 确认
- **M5 多机**：fleet 汇总 + 差异对比

## 7. 当前进度

- [x] 数据面核实（pi/CC/Codex 会话结构、pi extension 事件能力）
- [x] 资源管理骨架（skills/工具/项目级/去重候选/决策）
- [x] 脚本（scan/apply/fleet，只读 + dry-run 变更）
- [x] pi 包安装（本地路径）
- [x] **M1 数据层 + CLI**：三端适配器、统一 Schema、调用链重建、token 聚合、去重候选、记忆读取；`hm` 子命令（scan/resources/sessions/trace/slowest/token/dedupe/memories/freq）；8 个单元测试；tsc 编译通过
- [x] **M2 分析层**：会话检索(search)、token 趋势(trend)、时间线(timeline)、上下文规模+工具统计+CC慢调用(stats)；CC 会话 durationMs 计算；cwd 反推修复；17 个单元测试
- [x] **M3 服务与 Web 展示**：本地 HTTP 服务(`hm serve`, localhost:8787) + 单页可视化(仪表盘/资源/会话/调用链/token/去重/统计)；JSON API 全部通过 curl 冒烟验证
- [x] **M4 管理操作**：`apply.ts` 启停/迁移（dry-run→确认→落盘）；`hm apply <op> <id> [reason] [-y]`；Web `POST /api/apply` + 资源页操作按钮；写 DECISIONS.md + 更新缓存状态，不删文件不改 trust/gate/settings；21 个单元测试
- [x] **M5 多机**：`fleet.ts` ssh 只读汇总各机（cache.json/STATUS/探测三档降级）+ `diffFleet` 差异对比；`hm fleet` / `hm fleet-diff`；Web `GET /api/fleet` + 多机视图页；23 个单元测试
- [ ] 全部里程碑完成 — 待整体验收
- [ ] M4 管理操作（启停/迁移/接线，dry-run + 确认）
- [ ] M5 多机（fleet 汇总 + 差异对比）

## 8. 待确认

- Q23 系统形态（本地 Web 控制面确认）
- Q24 数据读取（历史读文件 + 实时 hook 结合确认）
- Q25 记忆/内存语义（长期规范 + 短期会话提炼确认）
- Q26 本次交付边界（建议 M1 起步）
- 技术栈（服务端 Node/TS？前端？）
- 部署形态（daemon 常驻 vs 按需启动）
