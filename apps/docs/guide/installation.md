# Installation & Quickstart

Requires Node.js **>= 22**. Nothing is installed globally — both the server and its CLI run through `npx` on demand.

## Set up

Start here. The interactive setup is the install path: it creates your connection config file, signs you in (or shows the API-key environment variable to set), and offers to install the companion Skill.

```bash
npx -p twenty-crm-mcp twenty-mcp setup
```

::: tip Why `-p twenty-crm-mcp`
The `twenty-mcp` CLI ships as a bin of the `twenty-crm-mcp` package, so `npx` needs `-p` (`--package`) to find it. Once the package is cached, later runs are instant.
:::

`setup` walks you through:

- **Adding a Twenty instance** — a label, its base URL, and an auth method: **OAuth** (browser sign-in, so the server acts as you) or **API key**.
- **Writing the connection** to `~/.config/twenty-mcp/connections.json`. The registry never stores secrets — API keys stay in your environment, OAuth tokens are encrypted separately.
- **Installing the companion Skill** — offered right after your first connection, and always available from the **Install companion skill** menu action. Choose **project** (`./.claude/skills/twenty-crm`) or **user** (`~/.claude/skills/twenty-crm`) scope; an existing copy is overwritten only after you confirm.

Re-run `setup` any time to add, edit, or remove connections, change the default, or (re)install the Skill. Related CLI commands: `twenty-mcp connections`, `twenty-mcp login <label>`, `twenty-mcp logout <label>` (each via `npx -p twenty-crm-mcp …`).

## Point your MCP client at the server

Add the server to your MCP config (`.mcp.json` or `claude_desktop_config.json`). Using **another agent** — Codex, Cursor, OpenCode, OpenClaw, Pi, …? See [MCP clients](/guide/mcp-clients) for each one's config location and format.

Using a named connection from `setup` (recommended — required for OAuth):

```json
{
  "mcpServers": {
    "twenty-crm": {
      "command": "npx",
      "args": ["-y", "twenty-crm-mcp"],
      "env": {
        "TWENTY_CONNECTION": "your-label"
      }
    }
  }
}
```

For an API-key connection, also supply its key in `env` (`TWENTY_API_KEY_<LABEL>`, or `TWENTY_API_KEY` as a fallback). To skip the registry entirely and pass an API key directly:

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

## Environment variables

| Env var | Required | Description |
| --- | --- | --- |
| `TWENTY_CONNECTION` | for a named connection | Label of a connection created by `setup` (see [Connections](/guide/connections)) |
| `TWENTY_BASE_URL` | for direct API-key mode | Base URL of your self-hosted Twenty instance, e.g. `https://crm.example.com` |
| `TWENTY_API_KEY` | for direct API-key mode | An API key created in Twenty under Settings > APIs & Webhooks |

To sign in as yourself instead of using a shared key, see [Authentication](/guide/authentication).

## Companion Skill

The server ships with a companion Skill that gives the model the operational knowledge to use it well (filter syntax, describe-before-write discipline, batch/upsert guidance, the `refresh_schema` recovery reflex). The quickest way to install it is `setup`, above.

Prefer to do it by hand? Copy `skill/twenty-crm` from the installed package (or a source checkout) into your `.claude/skills/` directory.
