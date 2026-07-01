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
