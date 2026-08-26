---
name: debt
description: Run a technical debt audit — TODOs, deprecated patterns, complex functions, outdated dependencies. Saves prioritised list to docs/debt.md. Use when the user types /debt or asks for a technical debt review.
allowed-tools: Read, Bash(grep:*), Bash(find:*), Bash(npm outdated:*), Bash(pip list:*), Write
---

## Task: Technical debt audit

Scan the codebase for technical debt and produce a prioritised list. Report only — do not fix anything until the user confirms.

### Pass 1: TODOs and deferred work
```bash
grep -rn "TODO\|FIXME\|HACK\|XXX\|TEMP\|KLUDGE\|@deprecated" \
  src/ --include="*.ts" --include="*.js" --include="*.py" --include="*.go"
```
Group by type. Note how long each has been there if determinable from git blame.

### Pass 2: Complexity
Find functions that are likely too complex:
- Functions over 50 lines
- Files over 300 lines
- Deeply nested conditionals (4+ levels)
- Functions with more than 5 parameters

```bash
find src/ -name "*.ts" -o -name "*.js" -o -name "*.py" | xargs wc -l | sort -rn | head -20
```

### Pass 3: Outdated dependencies
Check for outdated packages:
- Node: `npm outdated` or `yarn outdated`
- Python: `pip list --outdated`
- Go: `go list -u -m all`

Flag anything that is more than 2 major versions behind, or has known security advisories.

### Pass 4: Deprecated patterns
Look for:
- Deprecated API usage (marked with `@deprecated` or known deprecated methods)
- Old syntax that should have been migrated (e.g. `var` instead of `const/let`, callbacks instead of async/await)
- Test files with skipped/commented-out tests (`it.skip`, `xtest`, `@pytest.mark.skip`)
- Dead feature flags or config values that are never toggled

### Pass 5: Missing fundamentals
Check for:
- No tests for key modules (find test files, cross-reference against src files)
- No error handling in async functions
- Console.log / print statements left in production code
- Commented-out code blocks (more than 5 lines)

### Output the debt report

```
## Technical Debt Audit — [date]

### 🔴 High Priority
- [item] — [why it matters] — [estimated effort: S/M/L]

### 🟠 Medium Priority
- [item] — [why it matters] — [estimated effort: S/M/L]

### 🟡 Low Priority / Housekeeping
- [item]

### TODOs by age
[list TODOs with approximate age if determinable]

### Outdated dependencies
[table: package, current version, latest version, risk level]

### Summary
Total debt items: [n] | High: [n] | Medium: [n] | Low: [n]
Estimated total effort: [S/M/L/XL]
```

### Save
Write to `docs/debt.md`. Append with date header if file exists — debt should be tracked over time.

Report: "✅ Debt audit written to docs/debt.md"
