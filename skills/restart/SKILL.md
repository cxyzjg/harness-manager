---
name: restart
description: Load context from the last session — changes log and next steps from build plan. Use when the user types /restart or starts a new session and wants to resume.
allowed-tools: Read, Bash(git log:*), Bash(git branch:*)
---

## Task: Resume from last session

Load and report the following three things concisely so work can resume immediately.

---

### 1. Last session changes
Read `claude/changes.md` and output the **most recent entry only**.

---

### 2. Next steps
Read `specs/buildplan.md` and output the **most recent Next Steps section**.

---

### 3. Git state
Run:
- `git branch --show-current` — current branch
- `git log -1 --oneline` — last commit

---

### Session Brief
Output in this format:

```
## Session Brief — [YYYY-MM-DD]

**Last session summary:** [one paragraph from changes.md]

**Next steps:**
1. [task]
2. [task]
3. [task]

**Git:** Branch: [branch] | Last commit: [hash] [message]

Ready. What would you like to work on?
```

If any file is missing, note it and suggest running `/log` or `/changes` to initialise it.
