---
name: brief
description: Generate a one-page human-readable project brief for onboarding or re-orientation. Use when the user types /brief or asks for a project summary or overview.
allowed-tools: Read, Bash(find:*), Bash(git log:*), Bash(git branch:*)
---

## Task: Generate a project brief

Read the codebase and produce a concise, human-readable brief that lets someone (or you, after time away) understand the project in under 2 minutes.

### Step 1: Gather context
Read the following in order, stopping when you have enough to write the brief:
1. `README.md`
2. `claude/claude.md`
3. `specs/buildplan.md`
4. `package.json`, `pyproject.toml`, `go.mod`, or equivalent dependency file
5. `src/` — top-level structure only (don't recurse deeply)
6. `git log --oneline -10` — recent activity

### Step 2: Write the brief

Format:

```
## Project Brief — [project name] — [date]

### What it is
[2-3 sentences. What does this project do? Who is it for?]

### Stack
[Language, framework, key libraries — one line each]

### Structure
[4-6 bullet points describing the main folders and what lives in each]

### Current status
[What's done, what's in progress, what's next — from buildplan.md or git history]

### Key conventions
[3-5 most important rules from claude/claude.md — the things someone would get wrong without reading it]

### How to run it
[The commands to install, run, and test — from README or package.json scripts]
```

### Step 3: Save the brief
Write the brief to `docs/brief.md`. If the file already exists, overwrite it — this is always a fresh snapshot.

### Step 4: Confirm
Report: "✅ Brief written to docs/brief.md"
