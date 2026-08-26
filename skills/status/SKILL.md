---
name: status
description: Quick read-only project health snapshot. Use when the user types /status or wants a fast summary of current project state mid-session.
allowed-tools: Read, Bash(git status:*), Bash(git log:*), Bash(git branch:*)
---

## Task: Quick project status snapshot (read-only)

This command is read-only. Do not write or modify any files.

Gather and report the following:

1. **Git state**
   - Current branch: `git branch --show-current`
   - Last commit: `git log -1 --oneline`
   - Uncommitted changes: `git status --short`

2. **Open blockers**
   Read `specs/buildplan.md` — extract any blockers from the most recent status entry.

3. **Next steps**
   Read `specs/buildplan.md` — extract the most recent Next Steps list.

Output in this format:
```
## Status — [YYYY-MM-DD HH:MM]

**Git:** [branch] | [last commit hash + message]
**Uncommitted changes:** [count] files / or "Clean"

**Blockers:** [list or "None"]

**Next up:**
1. [task]
2. [task]
3. [task]
```

If build plan or changes files are missing, note which are absent.
