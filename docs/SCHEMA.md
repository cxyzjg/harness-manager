# 驾驶舱 (harness-manager) 统一数据模型 Schema v1

> 状态: **v1.0 — 已冻结为阶段1实现基准**；变更需在此文档记录 ADR。
> 原则: 字段英文 snake_case（展示层中文）；与具体 harness 无关；
>       每个 harness 通过 adapter 把私有格式"翻译"为本模型，可降级容错。

## 设计决策（阶段0 拍板）

| # | 决策 | 结论 |
|---|---|---|
| D1 | 存储 | SQLite (`better-sqlite3`)。JSONL 原始日志仍是事实源(fact source)，SQLite 是查询/聚合层 |
| D2 | 容错 | 单条解析失败→跳过+记入 `ingest_errors`；整文件损坏→会话标记 `degraded`；未知事件→丢弃+计数。绝不阻断整体导入 |
| D3 | 命名 | schema/代码英文 snake_case；中文只出现在 UI 渲染与说明字典 |
| D4 | 隐私 | 全部数据仅落本机（`~/.harness-manager/db.sqlite`）；零上传通道；git 仓库永不包含会话内容 |

## 概念模型

```
Harness ──produces──> SessionFile ──adapter翻译──> Session
Session ──ordered by ts──> Turn*            (用户回合, turn = agent 的一个工作单元)
Turn    ──contains──> [Thinking* → ToolCall* → TextOutput]
Session ──aggregates──> Cost / Metrics / Outcome   (派生值, 不入库存储, 可重算)
SkillInvocation ──link──> Skill(注册表) × Session/Turn  (技能触发记录)
```

## 实体定义

### HarnessId
`"pi" | "claude" | "codex" | "dsh"` —— 四端固定枚举，新 harness 新增枚举值+适配器。

### Session 会话
一次完整的 agent 工作过程。

| 字段 | 类型 | 说明 | 可空 |
|---|---|---|---|
| id | string | 稳定ID：`{harness}:{原始文件去扩展名}` | no |
| harness | HarnessId | 来源工具 | no |
| cwd | string | 会话工作目录 | yes |
| started_at | ISO8601 | 开始时间 | yes |
| ended_at | ISO8601 | 结束时间(最后事件时间) | yes |
| model | string | 主模型标识 | yes |
| degraded | boolean | true=解析时部分丢失(见 ingest_errors) | no, 默认false |
| source_file | string | 原始日志绝对路径(事实源指针) | yes |

注: `messages/tools/thinkings 计数`不存 Session 表——由 turns 聚合可查。

### Turn 用户回合
以 user 输入开头的最小工作单元。**turn 是回放、审查、指标下钻的基本粒度。**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | `{session_id}:t{序号}` |
| session_id | string | 所属会话 |
| idx | int | 从1递增 |
| ts | ISO8601 | 用户输入时间 |
| user_input | text | 用户输入全文(截断存库, 完整留原始文件) |
| context_before | json | 该turn开始时agent已见的上下文计数 `{messages, thinking, tools}` |

### ThinkingBlock 思考块
| 字段 | 说明 |
|---|---|
| session_id / turn_id / idx | 归属与顺序 |
| content | 思考正文(截断) |
| ts | 时间 |

### ToolCall 工具调用
| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 原 toolCallId 或合成id |
| turn_id | string | 所属回合(可能有则必有; 无法归属时挂在该会话首个turn) |
| name | string | 工具名 |
| input | json | 入参摘要截断 |
| output | json? | 结果(pi源常缺) |
| started_at / ended_at | ISO8601? | |
| duration_ms | int? | |
| is_error | bool | 规范化错误标志(output含error或显式error字段) |

### SkillInvocation 技能触发
| 字段 | 说明 |
|---|---|
| ts / cwd | 触发时间与项目 |
| skills | json数组: 本回合加载的技能名列表 |
| prompt_excerpt | 用户提示词摘录(≤200字符) |
| session_hint | 关联会话提示(pi extension来源无正式sessionId时的弱关联) |

### Cost 用量 (从 message usage 聚合)
| 字段 | 说明 |
|---|---|
| session_id | 归属 |
| model | 模型 |
| input_tokens / output_tokens | 累计 |
| recorded_at | 记录点 |

### Outcome 成效 (派生, 不建表)
由 metrics 模块从 Turn/ToolCall 实时计算: 错误率/重试率/空转率/等级ABCD/成效分。
不入库的理由：schema 变更时只需改计算函数重算，避免指标冻结在旧值。

## 派生指标口径 (v1)

- 错误率 = is_error 的 tool_calls / 总 tool_calls
- 重试率 = 相邻同名同参调用 / 总调用
- 空转率 = 无tool且无text且无thinking的 turn / 总 turn
- 可靠性等级: score = 100 - errRate*400 - retryRate*200 - emptyRate*100 → A≥85 B≥65 C≥40 else D
- 成效分: 写动作(+20/+10)、计划信号(+10)、无错(+5)、读→写闭环(+5), 扣减错误/重试/规模

## 存储布局

```
~/.harness-manager/
├── db.sqlite                  # 本Schema的SQLite实现
├── skill-registry.json        # 技能注册表(资源层, 非本Schema)
├── disabled-skills.json       # 启停名单
└── realtime/events.log        # pi extension实时流(独立, 不入SQLite)
```

## Adapter 契约

```ts
interface HarnessAdapter {
  id: HarnessId;
  available(): boolean;
  // 翻译: 私有格式 -> 统一模型; 容错规则见D2
  listSessions(): { fileId: string; path: string }[];
  parse(file: string): IngestResult;
}
interface IngestResult {
  session: UnifiedSession | null;      // null=整个文件不可用(记error)
  turns: Turn[]; thinkings: ...; toolCalls: ...; costs: Cost[];
  errors: IngestError[];               // 单条跳过明细
}
```

## 兼容性承诺

- v1 冻结后字段只增不改语义；废弃字段保留一个版本并标注 @deprecated
- 适配器输出的统一模型必须通过 `validateUnified()` 校验方可入库

---

## v2.1 增补（Agent Runtime 上下文与配置地基）

> 阶段0新增决策已拍板:
> **D5 context_snapshot 结构**: 拆4段 —— system_prompt / history / tool_result / file_content 各自token数(够用,不按文件粒度)
> **D6 AgentConfig 绑定策略**: 每次会话开始**快照一份配置**(强绑定), 会话独立可追溯, 不引用可变"当前配置"

### 新增实体

#### ContextSnapshot (turn级上下文构成, D5)
| 字段 | 说明 |
|---|---|
| turn_id | 归属回合 |
| system_prompt_tokens | 系统提示占用 |
| history_tokens | 历史消息占用 |
| tool_result_tokens | 工具返回占用 |
| file_content_tokens | 文件内容占用 |
| memory_entries_used | 引用的记忆条目(v2.2记忆治理预留) |
| snapshot_at | 快照时间 |

来源: pi=extension快照(before_agent_start的systemPrompt+usage); CC=message.usage估算。
无法精确拆分时填可得字段, 其余为null——**宁缺勿造**。

#### AgentConfig (agent配置快照, D6)
| 字段 | 说明 |
|---|---|
| id | cfg_{harness}_{hash12} |
| harness | 来源 |
| version_hash | 内容sha256前12位(同内容=同版本) |
| system_prompt | 全文(截断8k) |
| model / thinking_level | 模型与思考等级 |
| allowed_tools | json数组 |
| skills_loaded | json数组: 本回合加载的技能名 |
| created_at | 首次见到的时间 |

sessions.agent_config_ref → agent_configs.id
每turn可引用不同config(pi支持中途换模型/工具集), 因此turn也带config_ref。

### 存储布局更新
```
~/.harness-manager/
├── db.sqlite                  # +context_snapshots + agent_configs 两表; sessions/turns加ref列
└── realtime/events.log        # extension新增 config_snapshot / context_snapshot 事件流
```
