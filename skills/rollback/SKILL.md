---
name: rollback
description: Safely revert the last commit or staging push. Use when the user types /rollback or asks to undo the last commit or deployment. Always requires explicit confirmation before executing.
allowed-tools: Bash(git log:*), Bash(git revert:*), Bash(git reset:*), Bash(git status:*), Write
---

## Task: Rollback last commit or staging push

This command ALWAYS requires explicit user confirmation before making any changes.

---

### Step 1: Show what will be reverted
Run `git log -1 --stat` to display:
- Commit hash
- Commit message
- Files affected
- Author and timestamp

Output this clearly so the user knows exactly what will be undone.

---

### Step 2: Ask for confirmation
Output:
```
⚠️  About to revert the above commit. This cannot be automatically undone.

Type YES to confirm rollback, or anything else to cancel.
```

Wait for the user's explicit confirmation. If they do not type YES (case-insensitive), abort and report "Rollback cancelled."

---

### Step 3: Execute rollback (only if confirmed)
Use `git revert HEAD --no-edit` to create a new revert commit (safe, preserves history).

Do NOT use `git reset --hard` unless the user explicitly requests a hard reset and confirms they understand history will be rewritten.

---

### Step 4: Log the rollback
Append an entry to `claude/changes.md`:
```
## [YYYY-MM-DD HH:MM] Rollback

Reverted commit: [hash] — [message]
Reason: User-initiated rollback via /rollback
```

---

### Step 5: Report
```
✅ Rollback complete.
Reverted: [hash] — [message]
New commit: [revert hash]
Logged to claude/changes.md
```
