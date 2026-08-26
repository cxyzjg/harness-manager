---
name: run-tasks
description: Execute tasks from tasks.json with context management. Without args runs 1 task. With number runs N tasks.
argument-hint: [count]
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Run Tasks

Execute tasks from `tasks.json` with intelligent context management.

## Arguments

$ARGUMENTS

## Execution Steps

1. **Parse Arguments**
   - No argument or `1`: Execute exactly 1 task, then STOP
   - Number N > 1: Execute up to N tasks
   - After each task, check context usage (see step 6)

2. **Load tasks.json**
   - Read `tasks.json` from project root
   - Identify all tasks with `passes: false`
   - Build dependency map from `dependsOn` fields

3. **Select Next Task**
   - Find first incomplete task where ALL `dependsOn` are `passes: true`
   - If none exists: report status and STOP

4. **Execute Single Task**
   - Display: `▶ Executing: {id} - {description}`
   - For each step in `steps` array:
     - Complete the step using appropriate tools
     - Run verification (compile/test) if specified
   - On success: Update `passes: true` in tasks.json
   - On failure: STOP, DO NOT mark complete

5. **After Task Completion**
   - Display: `✅ Completed: {id}`
   - Show progress: `Progress: X/Y tasks`
   - If N > 1: decrement N, check context, continue to step 3
   - Otherwise: STOP

6. **Context Management** (between tasks)
   - Check context usage percentage
   - If usage > 60%:
     ```
     ⚠️ Context usage at {percent}%. Pausing for checkpoint.
     ```
     - Write checkpoint to `CLAUDE.md`:
       ```markdown
       ## Task Checkpoint
       - Last completed: {task-id}
       - Progress: X/Y tasks
       - Next task: {next-task-id}
       - Key decisions: {architectural choices made}
       ```
     - Prompt user: "Context high. Continue with /run-tasks {remaining} or /compact first?"
     - STOP and wait for user decision

## Error Handling

- If ANY step fails: STOP immediately
- Report error with task ID and step that failed
- DO NOT continue to next task
- Suggest: "Fix the error, then /run-tasks to continue"

## Example Usage

- `/run-tasks` - Execute ONE task only
- `/run-tasks 1` - Execute ONE task only
- `/run-tasks 5` - Execute up to 5 tasks (with context checks)
- `/run-tasks 100` - Long-running, will pause at 60% context

## Key Rules

- **Single task default**: No args = exactly 1 task
- **Context awareness**: Monitor and pause before context overflow
- **Checkpoint on pause**: Write recovery info to CLAUDE.md
- **Dependency respect**: Never skip dependencies
