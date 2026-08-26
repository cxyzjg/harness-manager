---
name: memory
description: Save module completion state to CLAUDE.md for long-running task recovery
disable-model-invocation: true
allowed-tools: Read, Write, Edit
---

# Memory

Save the current module completion state to CLAUDE.md.

## Execution Steps

1. **Gather Context**
   - Read `tasks.json` to find completed tasks in current module
   - Identify module by task ID prefix (e.g., `init-event-*` = event module)
   - List created files in module directory

2. **Read Existing CLAUDE.md**
   - Check if file exists
   - Read current content to preserve

3. **Write/Update Module Section**
   ```markdown
   ## Module: {module-name}

   ### Status
   - Completed: X/Y tasks
   - Status: {Complete|In Progress}

   ### Architecture
   - Package: {base-package}
   - Entities: {entity-list}
   - Services: {service-list}
   - Controllers: {controller-list}

   ### API Endpoints
   - `GET /{path}` - {description}
   - `POST /{path}` - {description}

   ### Key Decisions
   - {decision made}

   ### Files
   - `path/to/file.java` - {purpose}

   ### Issues/TODOs
   - {any blocking issues}
   ```

4. **Confirmation**
   ```
   📝 Memory saved to CLAUDE.md

   Module: {module-name}
   Tasks: X/Y complete
   ```

## Example Usage

- `/memory` - Save current module state
