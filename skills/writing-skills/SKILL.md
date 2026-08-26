---
name: writing-skills
description: Use when authoring a new pi skill or refining an existing one. Covers frontmatter rules, description quality, and progressive-disclosure structure.
---

# Writing Skills

Use when adding a new SKILL.md or revising one that isn't being picked up by the model.

## Anatomy

```
my-skill/
├── SKILL.md          # required
├── scripts/          # optional helpers
└── references/       # optional deep-dive docs
```

## Frontmatter

```yaml
---
name: my-skill                    # must match parent dir, lowercase + hyphens
description: <when to use it>     # this is the only thing always in context
---
```

The `description` is the *only* part the model sees until it decides to load the skill. Treat it like an ad: it must say *what the skill does* AND *when to reach for it*.

**Good:**
> Use when adding behavior that can be tested. Writes a failing test first, then minimum code to pass.

**Bad:**
> Helps with testing.

## Body structure

1. **Trigger** — one paragraph: "use this when X".
2. **Process / rules** — numbered or bulleted, executable steps.
3. **Anti-patterns** — what NOT to do (often more useful than the rules).
4. **Handoff** — which other skills pair naturally.

## Progressive disclosure

Keep SKILL.md short (under ~200 lines). Push detailed reference material into `references/*.md` and link to it. The model only loads SKILL.md initially; it will follow links if needed.

## Validation

Pi enforces the [Agent Skills spec](https://agentskills.io/specification):

- Name 1–64 chars, lowercase a-z, 0-9, hyphens only.
- Name must match parent directory.
- Description max 1024 chars.
- Missing description → skill not loaded.

## Test it

After adding, restart pi. The header should list your skill. Type `/skill:<name>` in interactive mode to force-load it and check the body renders cleanly.
