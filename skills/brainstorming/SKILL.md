---
name: brainstorming
description: Use before any non-trivial creative or design work — new features, vague requirements, "what should we build", architecture decisions. Surfaces intent and constraints before code is written.
---

# Brainstorming

Use this when the user's request is open-ended ("build X", "design Y", "what should we do about Z") and the requirements are not yet pinned down.

## Process

1. **Restate the goal in one sentence.** Confirm with the user.
2. **Ask 3–5 sharp questions** about the parts most likely to drive divergent solutions:
   - Who is the user / caller?
   - What is the success criterion?
   - What constraints exist (perf, deadlines, deps, compat)?
   - What's explicitly out of scope?
   - What's the simplest version that would be useful?
3. **Sketch 2–3 candidate approaches** at a high level. For each, note tradeoffs in one line.
4. **Recommend one** with reasoning. Invite the user to redirect.
5. **Stop here.** Do not write code until the user picks a direction.

## Anti-patterns

- Jumping to implementation on a fuzzy request.
- Producing one "obvious" answer without alternatives.
- Asking 15 questions at once — pick the load-bearing ones.

## Handoff

Once the user picks a direction, escalate to `writing-plans` if it's multi-step, or proceed directly if it's a one-file change.
