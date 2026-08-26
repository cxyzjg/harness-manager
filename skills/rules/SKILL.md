---
name: rules
description: Load and display the project rules from claude/claude.md. Use when the user types /rules or asks what the project conventions or rules are.
allowed-tools: Read
---

## Task: Load and display project rules

1. **Read `claude/claude.md`**
   Load the full contents of the file.

2. **Display**
   Output the contents in full so the user can review them.

3. **If the file does not exist**
   Report clearly:
   ```
   ⚠️  claude/claude.md not found.
   
   This file should contain your project's rules, conventions, and preferences 
   for how Claude should behave in this codebase.
   
   Suggested sections to include:
   - Coding standards (language, style, formatting)
   - Naming conventions
   - Preferred libraries or patterns
   - Things Claude should never do in this project
   - Folder structure conventions
   
   Would you like me to create a starter claude.md based on what I can see in the codebase?
   ```
