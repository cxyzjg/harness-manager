---
name: writing-plans
description: Use before multi-step or multi-file changes. Produces a written, ordered plan with explicit checkpoints so work can be paused, resumed, or handed off.
---

# Writing Plans

Use when a task spans more than one file, more than one logical step, or involves coordinated changes (schema + API + client, etc).

## Plan format

```
## Plan: <one-line goal>

**Context:** why this is being done (1-2 sentences)

**Steps:**
1. [ ] Step — file(s) — verification
2. [ ] Step — file(s) — verification
3. [ ] ...

**Out of scope:** what we are deliberately not doing
**Risks:** what could go wrong / what to watch for
```

## Rules

- Each step must name the file(s) it touches and how you'll verify it worked (test, command output, manual check).
- Order steps so each one leaves the codebase in a working state where possible.
- If a step depends on a decision the user hasn't made, mark it `[?]` and ask before proceeding past it.
- Keep plans short — 3–8 steps. If it's longer, the task is too big; split it.

## When to update the plan

- After each step: tick the box, note any deviation.
- If a step reveals new requirements, pause and revise the plan rather than silently expanding scope.

## Handoff

Once the plan is agreed, proceed step-by-step. Escalate to `test-driven-development` for steps that add testable behavior, and finish with `verification-before-completion` before declaring done.
