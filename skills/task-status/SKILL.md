---
name: task-status
description: Show current task completion status from tasks.json
allowed-tools: Read
---

# Task Status

Read and display the current status of all tasks in `tasks.json`.

## Instructions

1. Read `tasks.json` from the project root directory
2. Parse all tasks and their `passes` status
3. For each pending task, check if its `dependsOn` dependencies are satisfied
4. Display a formatted status report

## Output Format

```
## Task Status Summary

**Total**: X tasks | **Completed**: Y | **Pending**: Z | **Blocked**: B

### Completed Tasks ✓
- task-id-1: Description...
- task-id-2: Description...

### Pending Tasks (Ready)
- task-id-3: Description... (no dependencies)

### Blocked Tasks (Waiting on Dependencies)
- task-id-4: Description... (waiting on: task-id-5)
```

## Notes

- Tasks are "Ready" when all their `dependsOn` tasks have `passes: true`
- Tasks are "Blocked" when they have incomplete dependencies
- If no tasks file exists, report an error
