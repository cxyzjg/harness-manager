---
name: staging
description: Push the latest build to the staging environment. Use when the user types /staging or asks to deploy to staging.
allowed-tools: Bash(git status:*), Bash(git log:*), Bash(npm run build:*), Bash(yarn build:*), Bash(make:*)
---

## Task: Push latest build to staging

1. **Verify clean commit state**
   Run `git status`. If there are uncommitted changes, STOP and instruct the user to run `/commit` first.

2. **Confirm current branch and last commit**
   Run `git log -1 --oneline` and report the branch and last commit message.

3. **Run build step**
   Check for a build script in `package.json` (`npm run build`) or `Makefile` (`make build`). If found, run it. If the build fails, STOP and report the error clearly.

4. **Push to staging**
   Execute the project's staging deployment command. Common patterns:
   - `npm run deploy:staging`
   - `make deploy-staging`
   - `git push staging main`
   If no staging command is configured, report this clearly and list what was found.

5. **Report**
   Confirm the deployment status, staging URL (if available), and build output summary.
