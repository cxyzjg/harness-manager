---
name: security
description: Scan the codebase for security vulnerabilities — hardcoded secrets, injection risks, exposed credentials, insecure patterns. Use when the user types /security or asks for a security audit.
allowed-tools: Read, Bash(grep:*), Bash(find:*), Write
---

## Task: Security scan

Scan the codebase for security issues. This is a structured audit across 4 categories. Report findings before asking to fix anything.

### Step 1: Secrets and credentials scan
Search for hardcoded secrets, API keys, tokens, passwords:

```bash
grep -r --include="*.js" --include="*.ts" --include="*.py" --include="*.go" --include="*.env*" \
  -E "(api_key|apikey|api-key|secret|password|passwd|token|auth|credential|private_key)\s*[=:]\s*['\"][^'\"]{8,}" \
  . --exclude-dir=node_modules --exclude-dir=.git -l
```

Also check for common patterns:
- `sk-`, `ghp_`, `glpat-`, `xox` (Slack), `AKIA` (AWS) prefixes
- Anything that looks like a JWT (`eyJ...`)
- Base64 strings in non-test code that are unusually long

### Step 2: Injection vulnerabilities
Look for:
- SQL strings built with string concatenation or template literals instead of parameterised queries
- `eval()`, `exec()`, `subprocess.shell=True`, or similar dynamic code execution
- Unvalidated user input passed directly to file paths, shell commands, or database queries
- XSS vectors: unsanitised user content rendered as HTML (`innerHTML`, `dangerouslySetInnerHTML`)

### Step 3: Authentication and authorisation
Check for:
- Routes or endpoints with no auth middleware
- JWT tokens without expiry
- Passwords stored as plaintext or weak hashes (MD5, SHA1)
- Missing rate limiting on login or sensitive endpoints
- CORS configured as `*` in production code

### Step 4: Data exposure
Look for:
- Sensitive fields returned in API responses that shouldn't be (passwords, internal IDs, tokens)
- Error messages that expose stack traces, file paths, or internal details
- Logging of sensitive user data
- Files or directories exposed that shouldn't be (e.g. `.env` in a public folder)

### Step 5: Output the security report

```
## Security Audit — [date]

### 🔴 Critical (fix immediately)
- [file:line] — [issue] — [recommended fix]

### 🟠 High (fix before next deploy)
- [file:line] — [issue] — [recommended fix]

### 🟡 Medium (fix soon)
- [file:line] — [issue] — [recommended fix]

### 🔵 Low / informational
- [file:line] — [issue]

### Summary
[count] issues found. Critical: [n], High: [n], Medium: [n], Low: [n]
```

### Step 6: Save the report
Write the report to `docs/security-audit.md` with today's date. Append if file exists, don't overwrite history.

Do not fix anything until the user reviews the report and confirms.
