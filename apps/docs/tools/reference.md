# Tools reference

The CRM segment exposes a compact, business-oriented toolset. Every tool resolves against your live Twenty schema, and the surface is scoped to the core CRM objects — see [Object scoping](/tools/scoping).

Filter syntax (for the search/query tools): `field[operator]:value`, e.g. `name[eq]:Ada`.

## Discovery & schema

| Tool | Description |
| --- | --- |
| `list_object_types` | List the CRM objects available (scoped). Start here to see what you can query. |
| `describe_object` | Fields, types, and metadata for one object. Call before writing so you use real field names. |
| `refresh_schema` | Reload the live schema after adding/changing objects or fields, or when a tool reports a mismatch. |

## Reading

| Tool | Description |
| --- | --- |
| `find_contacts` / `find_companies` / `find_opportunities` | Scoped searches with the filter syntax above. |
| `query_records` | Generic scoped query with `filter`, `orderBy`, `limit`, `depth` (relations), and cursor pagination. |
| `get_record` | Fetch one record by id, with an optional `depth` (0–2) to inline related records. |
| `get_contact_brief` | One person by id plus related company, notes, tasks, opportunities, and recent activity. See [Composite reads](/tools/composites). |
| `get_account_snapshot` | One company by id plus related people, opportunities, notes, and tasks. |
| `search` | Full-text search across all searchable objects. Unscoped by design. |

## Writing

Write tools are batch-native: pass an array of 1–60 records, even for a single write.

| Tool | Description |
| --- | --- |
| `create_tasks` | Create 1–60 tasks in one batch. |
| `create_records` | Create 1–60 records of an in-scope object. |
| `update_records` | Update 1–60 records; each must include its `id`. |
| `delete_records` | Delete 1–60 records by id. |
| `upsert_records` | Create-or-update in one call; matched records are updated, others created. |

## Schema resource

A read-only `twenty://schema` MCP resource returns the live cached schema (scoped to the CRM objects) as JSON, for clients that consume resources.
