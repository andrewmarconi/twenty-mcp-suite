# Installation & Quickstart

Requires Node.js **>= 20**. There is no install step — run directly with `npx`.

## Quickstart (API key)

```bash
TWENTY_BASE_URL="https://crm.example.com" \
TWENTY_API_KEY="your-api-key" \
npx twenty-crm-mcp
```

| Env var | Required | Description |
| --- | --- | --- |
| `TWENTY_BASE_URL` | for API-key mode | Base URL of your self-hosted Twenty instance, e.g. `https://crm.example.com` |
| `TWENTY_API_KEY` | for API-key mode | An API key created in Twenty under Settings > APIs & Webhooks |
| `TWENTY_CONNECTION` | for OAuth mode | Name of a connection in your registry (see [Connections](/guide/connections)) |

## Claude Code / Claude Desktop

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

To sign in as yourself instead of using a shared key, see [Authentication](/guide/authentication).

## Companion Skill

The server ships with a companion Skill that gives the model the operational knowledge to use it well (filter syntax, describe-before-write discipline, batch/upsert guidance, the `refresh_schema` recovery reflex). Install it with the interactive setup command:

```bash
twenty-mcp setup
```

`setup` offers to install the Skill right after you add your first connection, and also exposes an **Install companion skill** action in its menu. Choose a **project** (`./.claude/skills/twenty-crm`) or **user** (`~/.claude/skills/twenty-crm`) install; an existing copy is overwritten only after you confirm.

Prefer to do it by hand? Copy `skill/twenty-crm` from the installed package (or a source checkout) into your `.claude/skills/` directory.
