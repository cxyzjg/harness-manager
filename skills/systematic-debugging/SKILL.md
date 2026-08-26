---
name: systematic-debugging
description: Use when something is broken or behaving unexpectedly — bugs, regressions, failing tests, mysterious errors. Forces a hypothesis-driven loop instead of guess-and-patch.
---

# Systematic Debugging

Use when the user reports a bug, a test fails unexpectedly, or output doesn't match expectations.

## Loop

1. **Reproduce.** Get a reliable, minimal repro. If you can't reproduce it, that's step 1 — don't theorize past an unreproducible bug.
2. **Observe.** Read the actual error, stack trace, and surrounding state. No assumptions.
3. **Hypothesize.** State *one* specific cause. "It might be X" — name X concretely.
4. **Test the hypothesis.** Add a print, read a related file, run a smaller version. Confirm or kill the hypothesis with evidence.
5. **Loop.** If killed, form a new hypothesis. Do not patch on a guess.
6. **Fix the root cause, not the symptom.** If the fix is "wrap in try/except and continue", stop — you found a symptom.
7. **Add a regression test** before closing out (pair with `test-driven-development`).

## Anti-patterns

- "Let me try a few things" — that's guessing, not debugging.
- Patching one site of failure when the root cause is upstream.
- Disabling a failing test to make CI green.
- Claiming a fix without reproducing the original bug *and* showing it's gone.

## Handoff

Always finish with `verification-before-completion`: re-run the original repro, the new regression test, and the broader suite.
