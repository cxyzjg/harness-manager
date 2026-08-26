---
name: dependencies
description: Scan the codebase and produce a plain-English map of how the main modules depend on each other. Saves to docs/dependencies.md. Use when the user types /dependencies or asks for a dependency map or module overview.
allowed-tools: Read, Bash(find:*), Bash(grep:*), Write
---

## Task: Map module dependencies

Analyse the codebase and produce a plain-English dependency map — what each major module does and what it depends on.

### Step 1: Discover modules
Find the main modules/packages in the project:
- List top-level folders in `src/`
- Identify key files (entry points, routers, controllers, services, models, utils)
- Look for `index.js/ts`, `main.py`, `app.go`, or equivalent entry points

### Step 2: Map imports and dependencies
For each major module:
- What does it import from other internal modules?
- What external libraries does it depend on?
- What does it export that other modules use?

Use grep to trace imports:
```bash
grep -r "from ['\"]\..*['\"]" src/ --include="*.ts" --include="*.js" -h | sort | uniq
```
Adapt for Python (`from . import`, `import .`) or Go (`import "./..."`).

### Step 3: Identify dependency patterns
Note:
- Circular dependencies (A imports B imports A)
- God modules (imported by many others, risky to change)
- Orphaned modules (nothing imports them)
- Deep chains (A → B → C → D — fragile)

### Step 4: Write the dependency map

Format:

```
## Dependency Map — [project name] — [date]

### Module Overview
| Module | Purpose | Depends on | Used by |
|---|---|---|---|
| src/auth | Handles login, sessions, JWT | src/db, src/utils | src/api, src/middleware |
| ... | | | |

### External Dependencies
| Library | Used by | Purpose |
|---|---|---|
| express | src/api, src/server | HTTP routing |
| ... | | | |

### Patterns and Risks
- **God modules:** [list any modules imported by 5+ others]
- **Circular dependencies:** [list any found, or "None found"]
- **Orphaned modules:** [list any, or "None found"]
- **Deep chains:** [list any chains of 4+ hops]

### Diagram (ASCII)
[Simple ASCII tree showing main dependency flow]
```

### Step 5: Save
Write to `docs/dependencies.md`. If file exists, overwrite — this is always a fresh snapshot.

Report: "✅ Dependency map written to docs/dependencies.md"
