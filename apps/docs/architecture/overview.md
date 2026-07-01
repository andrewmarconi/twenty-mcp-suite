# Suite overview

The `twenty-mcp-suite` is a modular set of MCP servers over a shared engine, rather than one monolithic connector.

- **`twenty-core`** — the reusable engine: raw REST/GraphQL transport, a live schema cache, the generic record primitives (query, get, search, CRUD, upsert), the capability-profile and audit layers, and the authentication stack.
- **Segments** — thin packages composed over the core. `twenty-crm-mcp` is the CRM segment; planned segments (Ops, Analytics) are opt-in capability packs. See the [Roadmap](/architecture/roadmap).

## Mechanism vs knowledge

The core principle: **tools are the mechanism, a Skill is the knowledge.** The tools are few, generic, and parameterized over the live schema — they encode no object or field names, so they rarely change. Twenty's filter DSL, recipes, and gotchas live in a companion [Claude Skill](/reference/skill) (markdown, edited not released). That split keeps the breakable surface — the code — minimal.

## Profiles turn generic tools into a curated segment

A **capability profile** is declarative configuration that scopes which objects are reachable and exposes business-named tools (`find_contacts`, `get_contact_brief`) over the generic primitives. Because a profile is data resolved against the live schema — not hand-written per-object code — the curated CRM surface adds no new breakable surface. See [Object scoping](/tools/scoping) and the [Tools reference](/tools/reference).
