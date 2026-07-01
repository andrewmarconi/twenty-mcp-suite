# Companion Skill

A Claude Skill ships alongside the server with the operational knowledge to use it well: the filter syntax for `query_records`, the describe-before-write discipline, batch and upsert guidance, the `refresh_schema` recovery reflex, and how the two auth modes select access.

This is the "knowledge" half of the [mechanism-vs-knowledge](/architecture/overview) split: it is markdown, edited rather than released, so guidance can evolve without a code change.

## Install

The quickest way is the `setup` CLI. Pass a scope to install it non-interactively:

```bash
# into the current project (./.claude/skills/twenty-crm)
npx -p twenty-crm-mcp twenty-mcp setup --install-skill --scope project

# or for your user account (~/.claude/skills/twenty-crm)
npx -p twenty-crm-mcp twenty-mcp setup --install-skill --scope user
```

This overwrites an existing copy without prompting. Interactive `setup` installs it too — it offers right after your first connection, and the **Install companion skill** menu action is always available (see [Installation](/guide/installation#set-up)).

Prefer to copy it by hand? The skill is a plain directory:

```bash
cp -r node_modules/twenty-crm-mcp/skill/twenty-crm .claude/skills/twenty-crm
# or, from a clone of this repo:
cp -r packages/twenty-crm-mcp/skill/twenty-crm .claude/skills/twenty-crm
```
