---
name: run-all-tasks
description: Execute all pending tasks with long-running workflow support (context management, checkpoints, recovery)
argument-hint: [--resume]
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent
---

# Run All Tasks (Long-Running Workflow)

Execute ALL incomplete tasks with full context management for long-running sessions.

## Arguments

$ARGUMENTS

## Pre-Flight Check

1. **Resume Check**
   - If argument is `--resume`: Read `CLAUDE.md` for checkpoint
   - Look for `## Task Checkpoint` section
   - Confirm with user: "Resuming from {last-task}, next: {next-task}?"

2. **Context Baseline**
   - Note starting context usage
   - Set warning threshold at 60%
   - Set critical threshold at 75%

## Main Execution Loop

```
WHILE incomplete tasks exist AND context < 75%:
    1. Select next ready task (dependencies satisfied)
    2. Execute task:
       ▶ [{X}/{total}] Executing: {id}
       - Complete all steps
       - Run verification
       - Update tasks.json: passes: true
       ✅ Completed: {id}

    3. Module completion check:
       IF current module fully complete:
           - Run: /memory
           - Write to CLAUDE.md:
             ## Module Complete: {module-name}
             - Tasks: {completed-list}
             - Key files: {created-files}
             - API endpoints: {endpoints}
             - Issues: {any-blocking-issues}

    4. Context check:
       IF context > 60%:
           ⚠️ Context at {percent}%. Creating checkpoint...
           - Write checkpoint to CLAUDE.md
           - Show: /cost summary
           - Ask: Continue or compact?

       IF context > 75%:
           🛑 Context critical. Stopping for safety.
           - Write full recovery state to CLAUDE.md
           - Show: /cost summary
           - Exit with resume instructions
```

## Checkpoint Format (CLAUDE.md)

```markdown
## Task Checkpoint - {timestamp}

### Progress
- Completed: X/{total} tasks
- Last completed: {task-id}
- Next task: {next-ready-task-id}

### Module Status
- Module: {current-module}
- Module progress: X/Y tasks
- Blocked by: {any-blocking-tasks}

### Key Decisions Made
- {architectural choice 1}
- {pattern used 2}

### Files Created This Session
- {file-1}: {brief description}
- {file-2}: {brief description}

### Recovery Instructions
Run: /run-all-tasks --resume
```

## Cost Tracking (/cost)

After each module or every 5 tasks, report:
```
📊 Session Stats
- Tasks completed: X
- Files created: Y
- Files modified: Z
- Estimated tokens: ~{estimate}
```

## Error Handling

- Task fails: Log error, mark as blocked, try next independent task
- Multiple failures: Stop and report, write checkpoint
- Context overflow: Emergency checkpoint, exit gracefully

## Final Report

```
## Execution Complete (or Paused)

**Completed**: X tasks
**Failed**: Y tasks
**Remaining**: Z tasks

### Failed Tasks
- {task-id}: {error reason}

### Resume Instructions
Run: /run-all-tasks --resume

### Or continue with
Run: /run-tasks {count}
```

## Integration Commands

- `/compact` - Compact context when high
- `/memory` - Save module completion to CLAUDE.md
- `/cost` - Show resource usage
- `/resume` - Resume from checkpoint (alias for --resume)

## Example Usage

- `/run-all-tasks` - Start/resume full execution
- `/run-all-tasks --resume` - Explicit resume from checkpoint
