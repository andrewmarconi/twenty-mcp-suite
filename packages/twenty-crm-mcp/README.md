# twenty-crm-mcp

A schema-adaptable, metadata-driven [MCP](https://modelcontextprotocol.io) server for self-hosted [Twenty CRM](https://twenty.com). It reads your live Twenty schema (objects, fields, types, relations) through the Metadata API and resolves every tool call against it, so your custom objects and fields work out of the box and a Twenty upgrade or schema change never requires a code release. The tool surface is deliberately curated: instead of mirroring raw endpoints, it exposes a compact, role-scoped CRM toolset (people, companies, opportunities, tasks, notes) and refuses anything outside that scope. When the schema drifts under a cached session, a dedicated `refresh_schema` tool gives the model an explicit recovery path, no restart required.

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

For a registry connection you can instead store the key **encrypted** in the same token store OAuth uses: run `twenty-mcp login <label>` on an `apikey` connection (or choose "Store it encrypted now" during `setup`), then start the server with just `TWENTY_CONNECTION`. Keys resolve in order: `TWENTY_API_KEY_<LABEL>` → `TWENTY_API_KEY` → the encrypted store — env vars always take precedence.

### OAuth sign-in (act as yourself, with your role)

Sign in through your browser so the assistant acts as **you**, inheriting your Twenty role (object/field/row permissions enforced by Twenty), with no long-lived key to manage. It uses Twenty's OAuth 2.0 authorization-code + PKCE flow with dynamic client registration ([RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)) and endpoint discovery ([RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414)), so it adapts to your instance automatically: public or confidential client, whatever endpoints your version exposes.

1. Create a connection registry at `~/.config/twenty-mcp/connections.json` (list one or more instances; pick one per server run with `TWENTY_CONNECTION`). You can write this by hand, or use the interactive `setup` command:

   ### Setup

   Run the interactive connection manager to create or edit `connections.json`.
   The `setup` command lives in the bundled `twenty-mcp` CLI (a separate bin from
   the server), so invoke it via `npx -p` — or drop the `npx -p twenty-crm-mcp`
   prefix if the package is installed:

   ```bash
   npx -p twenty-crm-mcp twenty-mcp setup
   ```

   It lets you add, edit, remove, and default Twenty sites, and can start the OAuth
   browser sign-in immediately after adding an OAuth site. For API-key sites it offers
   to store the key encrypted right away (masked prompt), or prints the exact
   environment variable to set (`TWENTY_API_KEY_<LABEL>`). No secrets are
   written to `connections.json`.

   #### Non-interactive (scripting / CI)

   Every action the interactive menu offers is also available as a single flag-driven
   command, useful for scripting or CI. Exactly one action flag is allowed per invocation:

   ```bash
   twenty-mcp setup --add <label> --url <url> --auth <oauth|apikey>
   twenty-mcp setup --edit <label> [--url <url>] [--auth <oauth|apikey>] [--label <new-label>]
   twenty-mcp setup --remove <label> [--purge-credentials]
   twenty-mcp setup --set-default <label>
   twenty-mcp setup --install-skill --scope <project|user>
   ```

   - `--add` with `--auth oauth` records the site only and prints a
     `twenty-mcp login <label>` hint — the browser sign-in flow does not run in
     non-interactive mode, so it works unattended in CI. Run `twenty-mcp login <label>`
     separately once you need a token.
   - `--add` with `--auth apikey` prints the `TWENTY_API_KEY_<LABEL>` env var to set
     (falls back to `TWENTY_API_KEY`). No secret is ever written to the registry — and
     none is accepted on argv; to store a key encrypted instead, run the interactive
     `twenty-mcp login <label>`.
   - `--install-skill` overwrites an existing skill without prompting.
   - `--remove` with `--purge-credentials` also deletes any stored credential for that
     label (OAuth tokens or a stored API key), not just the registry entry.

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

2. Sign in once with the bundled `twenty-mcp` CLI (opens your browser). The refresh token is stored **encrypted** (AES-256-GCM) under `~/.config/twenty-mcp/`, with the key file at mode `0600`; nothing sensitive is written in plaintext. Prefix each command with `npx -p twenty-crm-mcp` unless the package is installed:

   ```bash
   npx -p twenty-crm-mcp twenty-mcp login acme
   npx -p twenty-crm-mcp twenty-mcp connections   # list connections + signed-in state
   npx -p twenty-crm-mcp twenty-mcp logout acme   # remove stored credentials for a connection
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

A Claude Skill ships alongside the server with the operational knowledge to use it well: the filter syntax for `query_records`, the describe-before-write discipline, batch/upsert guidance, the `refresh_schema` recovery reflex, and how the two auth modes select access.

The recommended way to install it is the interactive setup command, which offers to install the skill after you add your first connection (and exposes an **Install companion skill** menu action you can run any time):

```bash
npx -p twenty-crm-mcp twenty-mcp setup
```

It prompts for a **project** (`./.claude/skills/twenty-crm`) or **user** (`~/.claude/skills/twenty-crm`) install, and overwrites an existing copy only after you confirm.

Or copy it by hand:

```bash
cp -r node_modules/twenty-crm-mcp/skill/twenty-crm .claude/skills/twenty-crm
# or, from a clone of this repo:
cp -r packages/twenty-crm-mcp/skill/twenty-crm .claude/skills/twenty-crm
```

## Compatibility & caveats

- **Validated live against self-hosted Twenty v2.17.2.** Confirmed against a running instance: OAuth sign-in (public/PKCE client, endpoint discovery), object-scoped curation (out-of-scope objects refused), and the `depth`-expanded composites (`get_contact_brief` / `get_account_snapshot`). Other versions are likely to work given Twenty's API stability and the discovery-driven OAuth, but have not been tested.
- **Three wire formats remain provisional** — inferred from documentation and not yet exercised against a live instance, so they may need adjustment:
  - **`search`** (`GET /rest/search`) — the exact query parameter names and response envelope are unverified.
  - **`upsert_records`** (GraphQL) — the generated mutation name casing (derived from the object's plural name) and the `upsert: true` argument shape are unverified.
  - **`aggregate`** (GraphQL) — the generated aggregation query shape (derived from the object's plural name and the requested ops) is unverified.
  - All three call sites are marked `// PROVISIONAL` in `packages/twenty-core/src/tools/readTools.ts`, `packages/twenty-core/src/tools/upsertTool.ts`, and `packages/twenty-core/src/tools/aggregateTool.ts`. If you hit a mismatch, please open an issue with the response Twenty actually returned.
