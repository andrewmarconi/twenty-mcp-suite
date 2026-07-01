# Companion Skill

A Claude Skill ships alongside the server with the operational knowledge to use it well: the filter syntax for `query_records`, the describe-before-write discipline, batch and upsert guidance, the `refresh_schema` recovery reflex, and how the two auth modes select access.

This is the "knowledge" half of the [mechanism-vs-knowledge](/architecture/overview) split: it is markdown, edited rather than released, so guidance can evolve without a code change.

## Install

Copy the skill directory into your project's or user's skills folder:

```bash
cp -r node_modules/twenty-crm-mcp/skill/twenty-crm .claude/skills/twenty-crm
# or, from a clone of this repo:
cp -r packages/twenty-crm-mcp/skill/twenty-crm .claude/skills/twenty-crm
```
