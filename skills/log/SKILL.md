---
name: log
description: Log current build status into specs/buildplan.md. Use when the user types /log or asks to update the build plan status.
allowed-tools: Read, Write
---

## Task: Log current build status to specs/buildplan.md

1. **Read the current build plan**
   Read `specs/buildplan.md` to understand project context and what was previously logged.

2. **Assess current state**
   Based on the conversation and any context available, determine:
   - What tasks have been completed since the last log entry
   - Any current blockers
   - What the next steps are

3. **Write a status entry**
   Use this schema exactly:

   ```
   ## [YYYY-MM-DD HH:MM] | Status: [In Progress / Blocked / Done]

   **Completed:** 
   - Task 1
   - Task 2

   **Blockers:** 
   - None / or describe blockers

   **Next:** 
   - Next step 1
   - Next step 2

   ---
   ```

4. **Append to specs/buildplan.md**
   Insert the new entry at the top of the log section (most recent first).
   If the file does not exist, create it with a `# Build Plan` header and the first entry.

5. **Confirm**
   Report that the entry was written.
