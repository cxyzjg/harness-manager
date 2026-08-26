---
name: using-git-worktrees
description: Use when starting risky, experimental, or long-running changes that should be isolated from the main working tree. Sets up a git worktree so the user's primary checkout stays clean.
---

# Using Git Worktrees

Use when:

- The change is exploratory and may be discarded.
- The user is mid-work on another branch and you need a clean slate.
- You need to compare two branches side-by-side.
- A long-running refactor would otherwise block other work.

## Setup

From the repo root:

```bash
git worktree add ../<repo>-<feature> -b <branch-name>
```

This creates a sibling directory checked out to a new branch. The user's main checkout is untouched.

## Working in the worktree

- All git commands operate on the worktree's branch.
- Changes here do not affect the main checkout until merged.
- Build artifacts and `node_modules` live separately — you may need to install deps fresh.

## Cleanup

When done:

```bash
# Merge or PR first, then:
git worktree remove ../<repo>-<feature>
git branch -d <branch-name>   # if merged
```

## When NOT to use

- Single-file changes on the current branch.
- Tasks the user expects to land on the current branch directly.
- When the user has uncommitted changes you'd be hiding from.

## Handoff

Pair with `writing-plans` for multi-step work in the worktree, and `verification-before-completion` before merging back.
