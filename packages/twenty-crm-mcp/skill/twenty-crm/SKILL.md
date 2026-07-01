---
name: twenty-crm
description: Use when interacting with Twenty CRM through the twenty-crm-mcp server — querying, creating, updating, or upserting people, companies, notes, tasks, opportunities, or custom objects. Covers the filter syntax, the describe-before-write discipline, batch/upsert guidance, and the refresh_schema recovery reflex.
---

# Working with Twenty CRM

This server is metadata-driven: object and field names come from your live Twenty schema, not hardcoded. Most tools take an `object` parameter naming the target Twenty object. Exceptions: `list_object_types` and `refresh_schema` take no arguments, and `search` takes a `query` (and optional `limit`) instead of an `object`.

## Connecting
The server authenticates in one of two ways, chosen by configuration (not by you at call time): an **API key** (`TWENTY_BASE_URL` + `TWENTY_API_KEY`), or **OAuth sign-in** where it acts as a real user and inherits that user's Twenty role. OAuth connections are named in a registry and selected with `TWENTY_CONNECTION`; signing in is a one-time `twenty-mcp login <label>` browser step done outside the assistant session. If a tool returns "Not signed in to connection … Run: twenty-mcp login …", tell the user to run that command — you cannot perform the browser sign-in yourself. Whatever the mode, the object and field access you get is bounded by the connection's Twenty permissions.

## Always do this first
1. Call `list_object_types` to see what objects exist (built-in and custom).
2. Before writing, call `describe_object` for the target object to use real field names and types. Do not guess field names — Twenty rejects unknown fields.

## Filter syntax (query_records)
- Format: `field[operator]:value`, e.g. `name[eq]:Acme`, `createdAt[gt]:2026-01-01`.
- Operators by field type: TEXT → eq, contains (use the documented operator names from `describe_object` types); NUMBER → eq, gt, lt, gte, lte; DATE_TIME → before/after/eq; BOOLEAN → is; relations → eq, isEmpty.
- Combine conditions with `and`/`or` per Twenty's filter grammar.
- Use `orderBy` like `createdAt[DescNullsLast]`, `limit` (max 60), `depth` (0–2) to include related records, and `cursor` for pagination.

## Reading records
- `query_records` — query with filters; see filter syntax above.
- `get_record` — fetch a single record by id. Input: `{ object, id }`.
- `search` — full-text search across searchable objects. Input: `{ query, limit? }` (no `object` parameter; searches multiple objects at once).

## Writing records
- All write tools are batch-native: pass an array of 1–60 records, even for a single write.
- `create_records` — new records.
- `update_records` — each record MUST include its `id`.
- `delete_records` — pass an array of ids.
- `upsert_records` — create-or-update in one call; records with a matching id/unique field are updated, others created. Prefer this for idempotent imports.

## Recipes
- Find a person by email, then attach a note:
  1. `query_records` object=people, filter=`emails.primaryEmail[eq]:a@b.com`.
  2. `create_records` object=notes with the note body, then link via the note's relation field to the person id (check the relation field name with `describe_object`).
- Link a record to a company: set the relation field (e.g. `companyId`) to the company's id; confirm the exact field name via `describe_object`.

## When something fails with a schema mismatch
If a tool reports "Unknown object" or a field error mentioning `refresh_schema`, the schema changed since the server cached it. Call `refresh_schema`, then retry. This is the normal recovery path after you add a custom object or field in Twenty.
