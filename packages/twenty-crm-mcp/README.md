# twenty-crm-mcp

A version-resilient, metadata-driven [MCP](https://modelcontextprotocol.io) server for self-hosted [Twenty CRM](https://twenty.com). It reads your live Twenty schema (objects, fields, types, relations) through the Metadata API and resolves every tool call against it, so your custom objects and fields work out of the box and a Twenty upgrade or schema change never requires a code release. The tool surface is deliberately curated: instead of mirroring raw endpoints, it exposes a compact, role-scoped CRM toolset (people, companies, opportunities, tasks, notes) and refuses anything outside that scope. When the schema drifts under a cached session, a dedicated `refresh_schema` tool gives the model an explicit recovery path, no restart required.

Part of the [`twenty-mcp-suite`](https://github.com/andrewmarconi/twenty-mcp-suite) monorepo. The reusable engine (transport, schema cache, generic primitives, auth) lives in `twenty-core`; this package is the CRM segment.

## Quickstart

Run directly with `npx`, no install step. The simplest setup uses a Twenty API key:

```bash
TWENTY_BASE_URL="https://crm.example.com" \
TWENTY_API_KEY="your-api-key" \
npx twenty-crm-mcp
```

| Env var | Required | Description |
| --- | --- | --- |
| `TWENTY_BASE_URL` | for API-key mode | Base URL of your self-hosted Twenty instance, e.g. `https://crm.example.com` |
| `TWENTY_API_KEY` | for API-key mode | An API key created in Twenty under Settings > APIs & Webhooks |
| `TWENTY_CONNECTION` | for OAuth mode | Name of a connection in your registry (see [Authentication](#authentication)) |

### Claude Code / Claude Desktop configuration

Add to your MCP config (`.mcp.json` or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "twenty-crm": {
      "command": "npx",
      "args": ["-y", "twenty-crm-mcp"],
      "env": {
        "TWENTY_BASE_URL": "https://crm.example.com",
        "TWENTY_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Authentication

The server supports two ways to authenticate to Twenty; both resolve to a bearer token used identically against Twenty's API.

### API key (simplest)

Provide `TWENTY_BASE_URL` + `TWENTY_API_KEY` (a key created in Twenty under Settings > APIs & Webhooks), as in the Quickstart above. The assistant acts with that key's permissions.

### OAuth sign-in (act as yourself, with your role)

Sign in through your browser so the assistant acts as **you**, inheriting your Twenty role (object/field/row permissions enforced by Twenty), with no long-lived key to manage. It uses Twenty's OAuth 2.0 authorization-code + PKCE flow with dynamic client registration ([RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)) and endpoint discovery ([RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414)), so it adapts to your instance automatically: public or confidential client, whatever endpoints your version exposes.

1. Create a connection registry at `~/.config/twenty-mcp/connections.json` (list one or more instances; pick one per server run with `TWENTY_CONNECTION`). You can write this by hand, or use the interactive `setup` command:

   ### Setup

   Run the interactive connection manager to create or edit `connections.json`:

   ```bash
   npx twenty-crm-mcp setup   # or: twenty-mcp setup
   ```

   It lets you add, edit, remove, and default Twenty sites, and can start the OAuth
   browser sign-in immediately after adding an OAuth site. For API-key sites it prints
   the exact environment variable to set (`TWENTY_API_KEY_<LABEL>`). No secrets are
   written to `connections.json`.

   Or write the file directly:

   ```json
   {
     "defaultConnection": "acme",
     "connections": {
       "acme":  { "baseUrl": "https://crm.example.com", "auth": "oauth" },
       "acme-stage": { "baseUrl": "https://stage.example.com", "auth": "oauth" }
     }
   }
   ```

2. Sign in once with the bundled `twenty-mcp` CLI (opens your browser). The refresh token is stored **encrypted** (AES-256-GCM) under `~/.config/twenty-mcp/`, with the key file at mode `0600`; nothing sensitive is written in plaintext:

   ```bash
   twenty-mcp login acme
   twenty-mcp connections     # list configured connections + signed-in state
   twenty-mcp logout acme     # remove stored tokens for a connection
   ```

3. Run the server against that connection (access tokens refresh automatically):

   ```json
   {
     "mcpServers": {
       "twenty-crm": {
         "command": "npx",
         "args": ["-y", "twenty-crm-mcp"],
         "env": { "TWENTY_CONNECTION": "acme" }
       }
     }
   }
   ```

## Tools

The CRM segment is scoped to the core CRM objects (**people, companies, opportunities, tasks, notes**). `list_object_types` shows only those; any call addressing an object outside the scope is refused. (Scope applies to the *addressed* object, not to related ids inside record bodies, which Twenty validates itself.)

**Discovery & schema**

| Tool | Description |
| --- | --- |
| `list_object_types` | List the CRM objects available (scoped). Start here to see what you can query. |
| `describe_object` | Fields, types, and metadata for one object. Call before writing so you use real field names. |
| `refresh_schema` | Reload the live Twenty schema after adding/changing objects or fields, or when a tool reports a mismatch. |

**Reading**

| Tool | Description |
| --- | --- |
| `find_contacts` / `find_companies` / `find_opportunities` | Scoped searches. Filter syntax: `field[operator]:value`, e.g. `name[eq]:Ada`. |
| `query_records` | Generic scoped query with `filter`, `orderBy`, `limit`, `depth` (relations), and cursor pagination. |
| `get_record` | Fetch one record by id, with an optional `depth` (0–2) to inline related records. |
| `get_contact_brief` | One person by id plus their related company, notes, tasks, opportunities, and recent activity (depth 1). |
| `get_account_snapshot` | One company by id plus its related people, opportunities, notes, and tasks (depth 1). |
| `search` | Full-text search across all searchable objects. (Unscoped by design, so results may reference objects outside the CRM scope.) |

**Writing** (batch-native: 1–60 records per call)

| Tool | Description |
| --- | --- |
| `create_tasks` | Create 1–60 tasks in one batch. |
| `create_records` | Create 1–60 records of an in-scope object. |
| `update_records` | Update 1–60 records; each must include its `id`. |
| `delete_records` | Delete 1–60 records by id. |
| `upsert_records` | Create-or-update in one call; matched records are updated, others created. |

A read-only `twenty://schema` MCP resource is also exposed, returning the live cached schema (scoped to the CRM objects) as JSON.

## Auditing

Every tool invocation emits one structured JSON line to **stderr** (stdout is reserved for the MCP protocol):

```json
{"audit":{"tool":"get_contact_brief","connection":"acme","env":"prod","outcome":"ok","ms":521}}
```

Audit records metadata only — tool name, connection label, environment, outcome, duration, and (on error) the error message. It never logs arguments, results, tokens, or record contents.

## Companion Skill

A Claude Skill ships alongside the server with the operational knowledge to use it well: the filter syntax for `query_records`, the describe-before-write discipline, batch/upsert guidance, the `refresh_schema` recovery reflex, and how the two auth modes select access. Install it by copying the skill directory into your project's or user's skills folder:

```bash
cp -r node_modules/twenty-crm-mcp/skill/twenty-crm .claude/skills/twenty-crm
# or, from a clone of this repo:
cp -r packages/twenty-crm-mcp/skill/twenty-crm .claude/skills/twenty-crm
```

## Compatibility & caveats

- **Validated live against self-hosted Twenty v2.17.2.** Confirmed against a running instance: OAuth sign-in (public/PKCE client, endpoint discovery), object-scoped curation (out-of-scope objects refused), and the `depth`-expanded composites (`get_contact_brief` / `get_account_snapshot`). Other versions are likely to work given Twenty's API stability and the discovery-driven OAuth, but have not been tested.
- **Two wire formats remain provisional** — inferred from documentation and not yet exercised against a live instance, so they may need adjustment:
  - **`search`** (`GET /rest/search`) — the exact query parameter names and response envelope are unverified.
  - **`upsert_records`** (GraphQL) — the generated mutation name casing (derived from the object's plural name) and the `upsert: true` argument shape are unverified.
  - Both call sites are marked `// PROVISIONAL` in `packages/twenty-core/src/tools/readTools.ts` and `packages/twenty-core/src/tools/upsertTool.ts`. If you hit a mismatch, please open an issue with the response Twenty actually returned.
