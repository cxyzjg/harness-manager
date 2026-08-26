---
name: wrapup
description: Run end-of-session sequence — commit, nextsteps, changes — then close out. Use when the user types /wrapup or says they're done for the session.
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*), Read, Write
---

## Task: End-of-session wrap up

Run the following three steps in order. If any step fails, STOP and report the error — do not silently continue.

---

### Step 1: /commit
Commit all changes to the dev branch.
- Check git status
- Run tests if configured
- Stage all changes
- Generate and apply a descriptive commit message
- Report: ✅ Committed [hash] or ❌ [error]

---

### Step 2: /nextsteps
Derive and log the next 3–5 prioritised tasks.
- Read specs/buildplan.md
- Analyse what remains
- Write concrete, ordered next steps
- Append to specs/buildplan.md
- Report: ✅ Next steps logged or ❌ [error]

---

### Step 3: /changes
Append the session log to claude/changes.md.
- Summarise all work done this session
- Append timestamped entry (most recent first)
- Report: ✅ Changes logged or ❌ [error]

---

### Final Report
Output a brief session summary:
```
Session wrapped up.
✅ Committed: [hash] — [message]
✅ Next steps: [count] tasks logged to specs/buildplan.md
✅ Changes: logged to claude/changes.md
```
