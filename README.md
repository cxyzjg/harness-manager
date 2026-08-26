# harness-manager

可分发、多机可复用的 **harness 资源管理系统**。

管理你的 skills、扩展、工具、项目级资源：解决技能过多导致的**重复 / 冲突**、**场景→技能归属不清**，以及 **pi / Claude Code / 多项目 / 多服务器 / 多用户共用**问题。

## 这是什么

一个 git 分发仓库（`github.com/cxyzjg/harness-manager`），承载：

- **共享技能**（单源，pi 与 Claude Code 多端引用）
- **共享扩展 / 自定义工具**
- **目录（Catalog）**：每个资源的来源、状态（active / duplicate-of / superseded / candidate）、归属（全局/项目）、场景→技能映射、去重决策
- **清单（Inventory）**：每台机器实际装了什么（`STATUS-<hostname>.md`）
- **脚本**：只读盘点、候选重复、带 dry-run 的变更、快速部署
- **文档**：索引、决策记录、多机安装/更新/迁移指南

## 快速上手

```bash
# 1. 获取本仓库（任选其一）
git clone https://github.com/cxyzjg/harness-manager.git
#   或作为 pi 包安装（在任意机器上）
pi install git:github.com/cxyzjg/harness-manager

# 2. 只读盘点本机，生成现状快照 + 候选重复报告
./scripts/scan.sh

# 3. 查看目录（Catalog）与决策记录
less docs/INDEX.md
less docs/DECISIONS.md

# 4. 任何变更前，先看 dry-run 输出，确认后执行
./scripts/apply.sh --dry-run <command>
```

## CLI（M1 数据层）

```bash
npm install            # 安装依赖
npm run hm -- scan     # 扫描 pi/CC/Codex 三端数据并缓存
npm run hm -- resources   # 列出资源 (skills/工具/扩展)
npm run hm -- sessions    # 列出会话
npm run hm -- trace <id>  # 显示某会话调用链树
npm run hm -- story <id>  # 执行轨迹+思考过程(完整追溯)
npm run hm -- slowest     # 最慢调用 Top10
npm run hm -- token       # token 聚合
npm run hm -- dedupe      # 去重候选（同名 + 功能重叠）
npm run hm -- memories    # 记忆/规范文件
npm run hm -- freq        # 工具调用频率
npm run hm -- search --project hb-ultra --query xxx   # 会话检索
npm run hm -- trend      # token 趋势(按项目/模型)
npm run hm -- timeline <id>   # 会话时间线
npm run hm -- stats      # 上下文规模 + 工具统计
npm run hm -- serve     # 启动 Web 控制面 → http://localhost:8787
npm run hm -- apply disable pi:global:code-review duplicate-of:review   # 管理操作(dry-run)
npm run hm -- apply disable pi:global:code-review duplicate-of:review -y  # 确认执行
npm run hm -- deploy [repoPath] [repoUrl] # 新服务器快速部署
npx vitest run            # 跑测试
```

## 核心概念

| 概念 | 放哪 | 全机一致？ |
|---|---|---|
| **Catalog 目录** | 仓库 `docs/INDEX.md`、`docs/DECISIONS.md` | ✅ 共享 |
| **Inventory 清单** | 各机 `docs/STATUS-<host>.md` | ❌ 各机本地 |
| **技能/扩展/文档/脚本** | 仓库，随包分发 | ✅ 共享 |
| **机器级配置**（settings 偏好 / tool-gate / trust / 模型） | 各机本地 | ❌ 不进包 |

## 全局 vs 项目

> **默认全局**；仅当能力**只对特定项目 / 项目类型有价值**时才放项目。
> 项目级资源（如 `hb-ultra` 的 `.pi/skills/`、`.claude/skills/`）纳入索引盘点。

## 多服务器使用（每机独立）

harness-manager 是**可分发**的：每台服务器数据独立，无需跨机同步/汇总。

- **快速部署**：新服务器上 `git clone` → `npm install` → `npm run hm -- deploy` → `hm serve`
- **各机自治**：每台机管理自己的 skills/会话/调用链/token，数据存 `~/.harness-manager/`
- **共享内容**：技能/扩展/决策/脚本随仓库分发，多机 `git pull` / `pi update` 获取更新，本机数据仍独立
- **变更只在各机本地**：`apply` 默认 dry-run，人工确认后才生效

详见 [`docs/INSTALL.md`](docs/INSTALL.md)。

## 目录结构

```
harness-manager/
├── README.md
├── package.json                 # pi package 清单
├── skills/manage-skills/        # 管理技能本体
├── extensions/                  # 共享扩展（自定义工具）
├── prompts/ themes/
├── docs/
│   ├── INDEX.md                 # Catalog 总索引 + 场景→技能映射
│   ├── DECISIONS.md             # 去重/归属决策记录
│   ├── INSTALL.md               # 多服务器部署/更新/迁移指南
│   └── STATUS-<host>.md         # Inventory 本机快照（脚本生成）
├── scripts/
│   ├── scan.sh                  # 只读盘点本机
│   └── apply.sh                 # 变更命令（dry-run+确认）
└── templates/
    └── settings.example.json    # 机器级配置模板
```

## 安全边界

- 本仓库只分发**能力与决策**，不自动改任何机器级配置
- 不自动写入 `trust.json` / `tool-gate.json` / 本机 `settings.json`
- 远程仅只读汇总；变更由各机管理员本地确认执行
