---
name: resume
description: Resume long-running task execution from CLAUDE.md checkpoint
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Bash
---

# Resume Tasks

Resume a paused task execution session from the checkpoint in CLAUDE.md.

## Execution Steps

1. **Read Checkpoint**
   - Read `CLAUDE.md` from project root
   - Find `## Task Checkpoint` section
   - Extract:
     - Last completed task ID
     - Next ready task ID
     - Module status
     - Key decisions made

2. **Display Recovery Info**
   ```
   🔄 Resuming from checkpoint

   **Previous session**:
   - Last completed: {task-id}
   - Progress: X/Y tasks
   - Module: {current-module}

   **Key context restored**:
   - {decision 1}
   - {decision 2}

   **Next task**: {next-task-id}
   ```

3. **Confirm Resume**
   - Ask: "Resume execution? (y/n)"
   - If yes: Proceed to run tasks
   - If no: Exit

4. **Continue Execution**
   - Read `tasks.json` to verify state
   - Start from next ready task
   - Follow `/run-tasks` or `/run-all-tasks` workflow

## If No Checkpoint Found

```
❌ No checkpoint found in CLAUDE.md

Options:
- /run-tasks - Execute one task
- /run-all-tasks - Execute all tasks
- /task-status - Check current progress
```

## Example Usage

- `/resume` - Resume from last checkpoint
