# INSTALL —— 多机安装 / 更新 / 迁移指南

harness-manager 是可分发的。这份文档说明如何在**任意服务器 / 任意用户**上部署、更新与迁移。

## 1. 在新机器上安装

### 前置
- 已安装 [pi](https://pi.dev)（或至少 git）
- 有本仓库的访问权限（ssh key / PAT）

### 方式 A：作为 pi 包安装（推荐，可 `pi update` 升级）

```bash
pi install git:github.com/cxyzjg/harness-manager
# 若私有仓库，确保本机 ssh key / PAT 已配置：
#  git config --global url."git@github.com:".insteadOf "https://github.com/"
```

安装后，pi 会从包加载 `skills/`、`extensions/`、`prompts/`、`themes/` 资源。
包克隆到 `~/.pi/agent/git/github.com/cxyzjg/harness-manager/`。

### 方式 B：git clone（手动复用）

```bash
git clone git@github.com:cxyzjg/harness-manager.git ~/harness-manager
cd ~/harness-manager
./scripts/scan.sh          # 只读盘点本机
```

### 机器级配置（各机独立，不随包）

1. 复制配置模板：
   ```bash
   cp templates/settings.example.json ~/.pi/agent/settings.json   # 按需修改
   ```
2. 根据 `docs/INDEX.md` 决定本机要启用哪些技能 / 扩展 / 工具
3. 信任哪些项目由各机自行决定（`trust.json` 不进包）

## 2. 更新

### 包更新
```bash
pi update                # 更新 pi 本身
pi update --extensions   # 更新包并 reconcile 固定 git ref
pi update git:github.com/cxyzjg/harness-manager   # 更新单个包
```

### git clone 方式
```bash
cd ~/harness-manager && git pull
```

> 固定 ref（tag/commit）不会随 `pi update --all` 自动移动；需要显式指定新 ref：
> `pi install git:github.com/cxyzjg/harness-manager@<new-ref>`

## 3. 迁移（换机器 / 换用户）

| 内容 | 是否需要手动迁移 |
|---|---|
| 技能、扩展、文档、脚本、决策 | ✅ 自动随仓库分发 |
| 各机 Inventory（`STATUS-<host>.md`） | ✅ 在新机重跑 `scan.sh` 生成 |
| 机器级 settings 偏好 | ❌ 各机自己改（从模板复制） |
| `tool-gate.json` 禁用/启用决策 | ❌ 各机自己定 |
| `trust.json` 信任项目 | ❌ 各机自己定 |

## 4. 多机 fleet 汇总（可选，只读）

前提：本机能 ssh 到各目标机，且各目标机已安装本仓库并跑过 `scan.sh`。

```bash
./scripts/scan-fleet.sh host1 host2 host3
```

该脚本**只读**：通过 ssh 拉取各机 `docs/STATUS-<host>.md`，聚合成全局视图。
**不做任何远程变更**——enable/disable/move 都由各机管理员在本地执行 `apply.sh`。

## 5. 常见问题

- **`pi install` 私有仓库失败**：检查 ssh key / PAT 与 `insteadOf` 配置
- **扫描不到某来源**：见 `scripts/scan.sh` 注释，确认该目录存在且为可信项目
- **同名技能冲突**：pi 同名先找到的赢；用 `docs/INDEX.md` 记录加载顺序与决策
