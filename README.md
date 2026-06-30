# twentycrm-mcp

A version-resilient, metadata-driven [MCP](https://modelcontextprotocol.io) server for
self-hosted [Twenty CRM](https://twenty.com). Instead of hardcoding object and field names,
the server reads your live Twenty schema (objects, fields, types) through the Metadata API
and resolves every tool call against it — including any custom objects and fields you've
added. Resilience comes from a clean split of concerns: the **10 tools** are the stable
mechanism (list, describe, query, read, search, write, upsert, refresh), a **companion
Claude Skill** carries the volatile knowledge (filter syntax, recipes, when to call
`describe_object` before writing), and a dedicated **`refresh_schema`** tool gives the model
an explicit recovery path when your Twenty schema drifts out from under a cached session —
no server restart required.

## Quickstart

Run directly with `npx` — no install step needed:

```bash
TWENTY_BASE_URL="https://crm.example.com" \
TWENTY_API_KEY="your-api-key" \
npx twentycrm-mcp
```

| Env var | Required | Description |
| --- | --- | --- |
| `TWENTY_BASE_URL` | yes | Base URL of your self-hosted Twenty instance, e.g. `https://crm.example.com` |
| `TWENTY_API_KEY` | yes | An API key created in Twenty under Settings > APIs & Webhooks |

### Claude Code configuration

Add to your MCP server config (e.g. `.mcp.json` or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "twenty-crm": {
      "command": "npx",
      "args": ["-y", "twentycrm-mcp"],
      "env": {
        "TWENTY_BASE_URL": "https://crm.example.com",
        "TWENTY_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Tools

| Tool | Description |
| --- | --- |
| `list_object_types` | List all available Twenty objects (built-in and custom). Use this first to discover what you can query. |
| `describe_object` | Return the fields, types, and metadata for one object. Call before writing so you use real field names. |
| `refresh_schema` | Reload the live Twenty schema. Call after adding/changing objects or fields, or when a tool reports a schema mismatch. |
| `query_records` | List records of one object with optional filter, orderBy, limit, depth (relations), and cursor pagination. |
| `get_record` | Fetch a single record by id. |
| `search` | Full-text search across searchable objects in Twenty. |
| `create_records` | Create 1–60 records of one object in a single batch. |
| `update_records` | Update 1–60 records of one object. Each record must include its id. |
| `delete_records` | Delete 1–60 records of one object by id. |
| `upsert_records` | Create-or-update 1–60 records of one object in a single call; matched records are updated, others created. |

A `twenty://schema` MCP resource is also exposed, returning the live cached schema
(objects and fields) as JSON.

## Companion Skill

A Claude Skill ships alongside the server with the operational knowledge needed to use it
well: the filter syntax for `query_records`, the describe-before-write discipline, batch and
upsert guidance, and the `refresh_schema` recovery reflex for schema drift. Install it by
copying the skill directory into your project's or user's skills folder:

```bash
cp -r node_modules/twentycrm-mcp/skill/twenty-crm .claude/skills/twenty-crm
# or, if working from a clone of this repo:
cp -r skill/twenty-crm .claude/skills/twenty-crm
```

## Compatibility & caveats

- Validated against self-hosted **Twenty v2.17.2** (Metadata API shape, REST CRUD and batch
  endpoints, GraphQL client). Other versions are likely to work given Twenty's API stability,
  but have not been tested.
- **Two wire formats are provisional** — built from documentation and reasonable inference,
  not yet confirmed against a live Twenty instance, and may need adjustment:
  - **`search`** (`GET /rest/search`) — the exact query parameter names and response
    envelope are unverified.
  - **`upsert_records`** (GraphQL mutation) — the generated mutation name casing (derived
    from the object's plural name) and the `upsert: true` argument shape are unverified.
  - Both call sites are marked with `// PROVISIONAL` comments in the source
    (`src/tools/readTools.ts`, `src/tools/upsertTool.ts`).
- Live integration verification against a running Twenty instance is planned (it would
  resolve the two items above) but is not yet included in this package — the deferred
  integration test suite was intentionally scoped out of this build. If you hit a mismatch,
  please open an issue with the response Twenty actually returned.
