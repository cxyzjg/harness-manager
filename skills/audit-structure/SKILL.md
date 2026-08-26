---
name: audit-structure
description: Audit an existing project against the standard structure and report gaps. Use when the user types /audit-structure or asks to check project structure consistency.
allowed-tools: Read, Bash(ls:*), Bash(find:*), Bash(cat:*)
---

## Task: Audit project structure against standard template

This is a READ-ONLY command. Do not create, modify, or delete any files.
Report findings only. Ask for confirmation before making any changes.

### Step 1: Scan current structure
Run `find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' | sort` to get a picture of the current project layout.

### Step 2: Check required folders
Verify each of the following exists:

| Folder | Purpose | Status |
|---|---|---|
| `src/` | Source code | ✅ / ❌ |
| `tests/` | Tests | ✅ / ❌ |
| `docs/` | Documentation | ✅ / ❌ |
| `scripts/` | Build and utility scripts | ✅ / ❌ |
| `specs/` | Specs and build plan | ✅ / ❌ |
| `claude/` | Claude workflow files | ✅ / ❌ |
| `claude/optimise/` | Custom optimise prompts | ✅ / ❌ |

### Step 3: Check required files
Verify each of the following exists and is non-empty:

| File | Purpose | Status |
|---|---|---|
| `CLAUDE.md` | Claude project instructions | ✅ / ❌ / ⚠️ empty |
| `README.md` | Project overview | ✅ / ❌ / ⚠️ empty |
| `.gitignore` | Git ignore rules | ✅ / ❌ |
| `specs/buildplan.md` | Build plan | ✅ / ❌ / ⚠️ empty |
| `claude/changes.md` | Session change log | ✅ / ❌ |
| `claude/claude.md` | Project rules | ✅ / ❌ / ⚠️ empty |

### Step 4: Check CLAUDE.md quality
If CLAUDE.md exists, read it and check:
- Does it reference the custom commands?
- Does it point to claude/claude.md for rules?
- Is it under 30 lines (lean)?

Flag issues but do not edit.

### Step 5: Output audit report

```
## Structure Audit — [project name] — [date]

### Folders
✅ src/
❌ tests/          ← missing
...

### Files
✅ CLAUDE.md
⚠️  claude/claude.md  ← exists but empty
❌ specs/buildplan.md ← missing
...

### Issues found: [n]

### Recommended fixes:
1. [Most important fix]
2. [Next fix]
...

Run /scaffold to automatically create all missing folders and files.
```

If everything is present and correct:
```
✅ Structure looks good. No issues found.
```
