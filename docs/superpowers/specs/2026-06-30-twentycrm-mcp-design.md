# TwentyCRM MCP Server — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorming complete, pending implementation plan)
**Owner:** Andrew (Five59 Labs)

## Problem

Existing open-source Twenty CRM MCP servers (the bundled `twenty-crm` server, jezweb/twenty-mcp, mhenry3164/twenty-crm-mcp-server, and others) are unreliable and break when new TwentyCRM versions land. The root cause is that they hardcode object types, field names, and endpoint shapes. Twenty generates its API per-workspace from workspace metadata, so any schema change — a version upgrade, a new field, a custom object — shatters servers that assume a fixed shape.

## Goal

A version-resilient, publishable MCP server for self-hosted Twenty, built so that a Twenty schema or version change is at most an edit to a Skill or a runtime cache refresh — never a code release.

Target environment: self-hosted Twenty (validated against v2.17.2 via Docker), API key auth. Primary client: Claude Code. Deliverable: an open-source npm package others can point at their own Twenty instance.

## Design principle: tools are mechanism, the Skill is knowledge

The core architectural lever is the division between deterministic tools and model-guided knowledge.

- **Tools = mechanism.** Few, generic, parameterized over the live schema rather than coupled to it. They rarely change because they do not encode object or field specifics.
- **Skill = knowledge.** Twenty's filter conventions, recipes, and gotchas live in a bundled Claude Code Skill. When Twenty changes, this is markdown to edit, not a server release.

This is what makes the server resilient: the breakable surface (code) is minimal and schema-agnostic; everything fluid is pushed into teachable text.

## Architecture

- **Language/runtime:** TypeScript on the official `@modelcontextprotocol/sdk`, published to npm, run via `npx`, **stdio** transport.
- **Configuration (env only):** `TWENTY_BASE_URL`, `TWENTY_API_KEY`. No other required config.
- **Two API clients, one schema cache:**
  - **REST client** — Core API (`/rest/{objectNamePlural}`) for record CRUD, and Metadata API (`/rest/metadata/`) for schema discovery.
  - **Minimal GraphQL client** — used *only* for `upsert_records` (batch create-or-update is GraphQL-only in Twenty).
  - **Schema cache (in-memory)** — lazy-loaded on first tool call from the Metadata API so the server starts even if Twenty is unreachable. Maps each object to its plural REST path, fields, types, and relations, including custom objects. Every record tool resolves its `object` argument against this cache to build correct URLs and validate fields. Repopulated by `refresh_schema`. Exposed read-only as an MCP resource so the model can inspect available objects and fields without spending a tool call.

### API facts (verified against current Twenty docs)

- Two APIs, both REST and GraphQL: Core API for record CRUD (people, companies, opportunities, custom objects), Metadata API for schema (objects, fields, relations).
- Auth: `Authorization: Bearer <API_KEY>`.
- Batch: REST supports batch create/update/delete up to 60 records per request. GraphQL adds batch upsert (create-or-update in one call using plural object names) and single-query relation traversal.

## Resilience model

- Nothing hardcodes object or field names; all operations are driven by the live schema cache.
- **Drift is handled manually (v1).** When a record operation fails because of a schema mismatch (a 404 on an unknown object, a rejected unknown field), the tool returns a clear error message that explicitly names `refresh_schema`. The model decides to refresh the cache and retry. No silent auto-heal in v1 — behavior stays transparent. Auto-heal (refresh-once-and-retry on a drift-shaped error) is a deferred enhancement.
- Volatile know-how lives in the Skill, not in code.

## Tool surface

Approximately ten tools, batch-native by default. Write tools always take an array of 1–60 records; a single write is a one-element array. This avoids doubling the surface with separate single and batch variants and makes batching free everywhere.

**Schema (mechanism + control)**

- `list_object_types` — list available objects from the cache.
- `describe_object` — fields, types, and relations for one object.
- `refresh_schema` — repopulate the schema cache from the Metadata API.

**Read**

- `query_records` — filter, sort, and paginate one object (REST).
- `get_record` — fetch one record by id (REST).
- `search` — text search. Implementation (Twenty GraphQL `search` query vs. filtered `query_records`) to be confirmed during planning.

**Write — REST, batch-native (1–60)**

- `create_records`
- `update_records` — each record carries its id.
- `delete_records` — list of ids.

**Write — GraphQL**

- `upsert_records` — batch create-or-update, matching on id or a unique field.

## Companion Skill

Bundled in the repository under `skill/`, installable by dropping into `.claude/skills/`. It carries:

- Twenty's filter and sort DSL.
- The "describe before you guess fields" discipline (call `describe_object` or read the schema resource before constructing writes).
- Common recipes: find a person by email then attach a note; link a record to a company; batch import patterns.
- Batch and upsert guidance, including when to prefer `upsert_records`.
- The drift reflex: on a schema-mismatch error, call `refresh_schema` and retry.

## Testing and quality

- Unit tests against a mocked Twenty REST and GraphQL surface, written test-first (TDD). Focus areas: schema-cache construction, REST URL building from cached plural names, batch payload shaping, and drift error messaging that names `refresh_schema`.
- Optional integration tests gated behind env vars, hitting a real Twenty instance.
- README with quickstart, env configuration, `npx` usage, and Skill install steps.

## Out of scope (v1, YAGNI)

- HTTP / remote / multi-tenant transport (stdio only).
- GraphQL-first record CRUD (REST-first; GraphQL only for upsert).
- Auto-heal on schema drift.
- Metadata *writes* (creating objects/fields programmatically) — read-only schema use for now.
- Designing around custom objects specifically; they are supported as a by-product of the metadata-driven design.

## Open items for the planning phase

- Confirm Twenty's `search` mechanism for v2.17.2 (GraphQL `search` query vs. filtered REST query).
- Confirm the exact GraphQL batch-upsert mutation shape and conflict-key semantics for v2.17.2.
- Confirm the Metadata API response shape used to build the cache (object plural names, field types, relation descriptors).
