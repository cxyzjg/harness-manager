---
name: dispatching-parallel-agents
description: Use when the task contains 2+ independent sub-tasks that don't depend on each other's outputs. Run them concurrently to save wall-clock time.
---

# Dispatching Parallel Agents

Use when the work decomposes into independent units — independent meaning *no sub-task needs another's output*.

## When it applies

- Reading multiple unrelated files for context.
- Running independent searches/greps.
- Investigating two unrelated bugs in one session.
- Fetching data from multiple sources.

## When it does NOT apply

- Sequential dependencies ("first migrate the schema, *then* update the API").
- One task whose result determines whether the other should run.
- Anything where ordering matters for safety (e.g., write-then-read).

## How

In environments that support parallel tool calls, batch independent reads/searches in a single response. In environments that support subagent dispatch, fan out the independent units and join their results.

If neither is available, do them sequentially — but still identify them as independent so you don't accidentally serialize on a false dependency.

## Anti-patterns

- Parallelizing writes to the same file.
- "Parallel" calls where call N actually needs the output of call N-1.
- Forcing parallelism on a task that's naturally sequential.
