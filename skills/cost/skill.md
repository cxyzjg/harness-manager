---
name: cost
description: Show resource usage and task statistics for the current session
disable-model-invocation: true
allowed-tools: Read, Bash
---

# Cost

Display resource usage statistics for the current task execution session.

## Execution Steps

1. **Read tasks.json**
   - Count completed tasks (passes: true)
   - Count remaining tasks (passes: false)
   - Identify failed/blocked tasks

2. **Estimate File Operations**
   - Count files in target module directory
   - List created/modified files

3. **Display Report**
   ```
   📊 Session Cost Report

   ### Task Progress
   - Completed: X tasks
   - Remaining: Y tasks
   - Blocked: Z tasks (dependencies)

   ### File Operations
   - Created: X files
   - Modified: Y files

   ### Estimated Resources
   - Input tokens: ~{estimate} (file reads, context)
   - Output tokens: ~{estimate} (writes, edits)

   ### Module Breakdown
   | Module | Completed | Total | Status |
   |--------|-----------|-------|--------|
   | event  | 5/10      | 10    | 50%    |
   | search | 0/8       | 8     | 0%     |
   ```

## Example Usage

- `/cost` - Show session statistics
