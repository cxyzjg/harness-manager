---
name: nextsteps
description: Derive and record the next 3-5 prioritised tasks from the current build plan. Use when the user types /nextsteps or asks what to work on next.
allowed-tools: Read, Write
---

## Task: Derive and record next steps

1. **Read the build plan**
   Read `specs/buildplan.md` in full to understand current progress, completed tasks, and any blockers.

2. **Analyse and prioritise**
   Based on what's been done and what remains:
   - Identify the 3–5 most important next tasks
   - Order them by priority (unblocked, highest impact first)
   - Make each task concrete and actionable — not vague (e.g. "Add input validation to /api/user endpoint" not "improve validation")

3. **Output next steps**
   Present them clearly in the conversation:

   ```
   ## Next Steps — [YYYY-MM-DD]

   1. [Highest priority task] — reason
   2. [Next task] — reason
   3. [Next task] — reason
   4. [Optional]
   5. [Optional]
   ```

4. **Append to specs/buildplan.md**
   Append the next steps block under a `## Next Steps` section header with today's date. If the section exists, add a new dated entry rather than replacing.

5. **Confirm**
   Report that next steps have been logged.
