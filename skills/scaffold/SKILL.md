---
name: scaffold
description: Generate a standard project structure for a new project. Use when the user types /scaffold or asks to set up a new project structure.
allowed-tools: Read, Write, Bash(mkdir:*), Bash(cp:*), Bash(touch:*), Bash(ls:*), Bash(cat:*), Bash(test:*)
---

## Task: Scaffold a new project with standard structure

Arguments: $ARGUMENTS (optional — use as project name if provided)

### Step 1: Determine project root

Use the current working directory as the project root. If $ARGUMENTS is provided, treat it as the project name and confirm with the user before proceeding.

### Step 2: Detect existing structure

Run `ls -la` to see what already exists. Note any files or folders already present — do not overwrite them.

### Step 3: Create standard folder structure

Create any of the following that do not already exist:

```
src/                   ← all source code
tests/                 ← all tests
docs/                  ← documentation
scripts/               ← build, deploy, utility scripts
specs/                 ← specs and planning
claude/                ← Claude workflow files
claude/optimise/       ← custom optimise prompts
```

Use `mkdir -p` for each. Skip any that already exist.

### Step 4: Create standard files

Create any of the following that do not already exist. Never overwrite existing files.

**README.md**

```
# [Project Name]

## Overview
[Description]

## Setup
[Setup instructions]

## Usage
[Usage instructions]
```

**specs/buildplan.md**

```
# Build Plan

## Overview
[Project overview and goals]

## Status
In Progress

---
```

**claude/changes.md**

```
# Session Change Log

---
```

**claude/claude.md**

```
# Project Rules

## Stack
[Language, framework, key libraries]

## Conventions
- [Naming conventions]
- [File structure rules]
- [Code style preferences]

## Things Claude should never do
- Edit .env or secrets files
- Commit directly to main
- [Add project-specific rules]

## Key commands
- [How to run the project]
- [How to run tests]
- [How to build]
```

**.gitignore** (if not present)

```
node_modules/
.env
.env.local
.env.production
dist/
build/
*.log
.DS_Store
```

**CLAUDE.md** (if not present — copy from template or generate)

```
# [Project Name]

See claude/claude.md for full project rules.

## Commands
/commit, /staging, /changes, /log, /nextsteps, /wrapup, /restart, /optimise, /rules, /status, /rollback, /scaffold, /audit-structure

## Structure
src/ — source code
tests/ — tests
docs/ — documentation
scripts/ — scripts
specs/ — build plan, specs, and hosting reference
claude/ — Claude workflow files
```

### Step 5: Copy hosting reference

The hosting reference at `H:/Projects/Claude/hosting.md` is a living document describing the shared Hetzner VPS setup. Copy it into `specs/hosting.md` if it does not already exist:

1. Check if `specs/hosting.md` already exists — if so, skip this step.
2. Read `H:/Projects/Claude/hosting.md` and write its contents to `specs/hosting.md`.

This gives every new project immediate context about the deployment target — server details, Docker architecture, nginx routing, deploy pipeline, and the process for adding a new project to the VPS.

### Step 6: Report

List everything that was created and everything that was skipped (already existed). Output:

```
✅ Scaffolded: [project name]

Created:
- [list of folders/files created]

Skipped (already existed):
- [list of folders/files skipped]

Next: Fill in claude/claude.md with your stack and conventions, then run /rules to verify.
```
