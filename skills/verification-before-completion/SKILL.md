---
name: verification-before-completion
description: Use before claiming a task is done, fixed, shipped, or working. Requires running the relevant checks and showing evidence — never claim success without proof.
---

# Verification Before Completion

Use immediately before any statement that work is complete: "done", "fixed", "shipped", "ready", "working".

## Required evidence

Before claiming success, run and show output for whichever apply:

- **Tests** — run the relevant suite (or a clearly-scoped subset). Paste the result.
- **Type/lint checks** — if the project has them, they pass.
- **Build** — if the change touches build output, the build succeeds.
- **Original repro** — for bug fixes, re-run the user's original failing case and show it passes.
- **Smoke check** — for behavior changes, run the actual command/endpoint/UI flow and show output.

## Rules

- Type checks and tests verify *code correctness*, not *feature correctness*. For UI or product behavior, you must also exercise the feature, not just compile it.
- If you cannot run something (no env, no creds, sandbox), say so explicitly — "I could not verify X because Y" — rather than silently skipping it.
- Never claim success on the basis of "the code looks right." Looking right is not running.

## Output template

```
✅ Verified:
- tests: <command> — <result>
- types: <command> — <result>
- repro: <how reproduced original bug, now fixed>

⚠️ Not verified:
- <thing> — <why> — <how user can verify>
```

## Anti-patterns

- "This should work" without running it.
- Running tests, seeing failures, and not mentioning them.
- "All tests pass" when you only ran one file.
