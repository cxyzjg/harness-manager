---
name: commit
description: Commit all current changes to the dev branch. Use when the user types /commit or asks to commit changes.
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*), Bash(npm test:*), Bash(yarn test:*)
---

## Task: Commit all changes to dev

1. **Check working tree state**
   Run `git status` and `git diff HEAD` to understand what has changed.

2. **Check for conflicts**
   If there are merge conflicts or a dirty working tree in a conflicted state, STOP and report the issue clearly. Do not proceed.

3. **Run tests (if configured)**
   If a test script exists in `package.json` or a `Makefile`, run tests first. If tests fail, STOP and report — do not commit broken code.

4. **Stage all changes**
   Run `git add -A` to stage all modified, added, and deleted files.

5. **Write a commit message**
   Generate a clear, descriptive commit message summarising what changed in this session. Format:
   ```
   [type]: short summary

   - Bullet list of specific changes
   ```
   Where `[type]` is one of: `feat`, `fix`, `refactor`, `chore`, `docs`.

6. **Commit to dev**
   Run the commit on the `dev` branch. If not already on `dev`, report the current branch and ask before proceeding.

7. **Report**
   Confirm the commit hash, branch, and message. Note: this does NOT push to remote.
