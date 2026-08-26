---
name: optimise
description: Run a structured optimisation sweep across the codebase — redundancy, efficiency, dead code. Use when the user types /optimise or asks for a codebase cleanup or refactor pass.
allowed-tools: Read, Write, Bash(find:*), Bash(grep:*)
---

## Task: Structured codebase optimisation

Run the following passes in order. After each pass, output a report of findings. Ask for confirmation before applying any changes.

---

### Pass 1: Redundancy
- Find duplicate logic, repeated code blocks, or functions that do the same thing in different places
- Identify files or modules with overlapping responsibilities
- Report: list of redundancies with file locations

### Pass 2: Streamline verbose logic
- Look for overly complex conditionals that can be simplified
- Find multi-step operations that could be reduced
- Identify unnecessarily long functions that should be split or condensed
- Report: list of candidates with suggested simplifications

### Pass 3: Performance inefficiencies
- Find N+1 patterns, unnecessary loops, or repeated expensive operations
- Look for synchronous operations that should be async
- Identify large imports where only a small part is used
- Report: list of inefficiencies with severity (low / medium / high)

### Pass 4: Dead code
- Find unused imports, variables, functions, and exported symbols
- Look for commented-out code blocks that should be removed
- Identify unreachable code paths
- Report: list of dead code with file and line references

---

### Custom prompt files
Before running the above passes, check if `claude/optimise/` exists. If it contains `.md` prompt files, load and execute each one as an additional custom pass. Name each pass after the filename.

---

### Apply changes
After all passes are reported:
1. Present a summary of all findings across passes
2. Ask: "Apply all changes, apply selectively, or skip?"
3. Apply only what is confirmed
4. Run a final `git diff` summary of what was changed
