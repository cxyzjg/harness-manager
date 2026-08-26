---
name: changes
description: Append a log of all changes made in this session to claude/changes.md. Use when the user types /changes or asks to log session changes.
allowed-tools: Read, Write, Bash(git log:*), Bash(git diff:*)
---

## Task: Append session changes to claude/changes.md

1. **Gather session activity**
   Review the conversation history and any git activity (`git log --since="session start" --oneline`) to compile what was done.

2. **Write the log entry**
   Format the entry as:

   ```
   ## [YYYY-MM-DD HH:MM] Session Log

   **Summary:** One paragraph describing the overall work done this session.

   **Changes:**
   - [file or feature] — what was done
   - [file or feature] — what was done
   - ...

   **Decisions made:**
   - Any architectural or design decisions recorded here

   ---
   ```

3. **Append to claude/changes.md**
   - If the file exists: APPEND the new entry at the top (most recent first). Never overwrite.
   - If the file does not exist: Create it with a header and the first entry.

4. **Confirm**
   Report that the entry was written and show the first few lines.
