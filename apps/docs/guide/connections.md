# Connections & multi-instance

Connections let you register one or more Twenty instances and pick which one a server run targets — useful if you manage several instances (production and staging, or multiple orgs).

## Interactive setup (recommended)

`twenty-mcp setup` is an interactive way to create and manage your connection registry — no hand-editing JSON. It works identically on macOS and Windows.

```bash
npx twenty-crm-mcp setup   # or, if twenty-mcp is on your PATH: twenty-mcp setup
```

It opens a menu that lets you:

- **Add a site** — enter a label, base URL, and auth method (`oauth` or `apikey`).
- **Edit or remove** an existing site.
- **Set the default** connection.
- For an **OAuth** site, start the browser sign-in immediately after adding it.
- For an **API-key** site, print the exact environment variable to set (`TWENTY_API_KEY_<LABEL>`).

Changes are saved after each step, so quitting partway through keeps what you already added. **No secrets are written to the registry** — API keys stay in your environment, and OAuth tokens are stored encrypted separately (see [Authentication](/guide/authentication)).

## The registry file

`setup` reads and writes the registry at:

- **macOS / Linux:** `~/.config/twenty-mcp/connections.json`
- **Windows:** `C:\Users\<you>\.config\twenty-mcp\connections.json`

The suite uses the same `.config` layout on every platform (it does not use `%APPDATA%`). Override the full file path with `TWENTY_MCP_CONFIG`, or the base directory with `XDG_CONFIG_HOME`. You can also create or edit the file by hand:

```json
{
  "defaultConnection": "acme",
  "connections": {
    "acme":       { "baseUrl": "https://crm.example.com",   "auth": "oauth" },
    "acme-stage": { "baseUrl": "https://stage.example.com", "auth": "oauth" },
    "other":      { "baseUrl": "https://crm.other.com",     "auth": "apikey" }
  }
}
```

Each connection is either `oauth` (browser sign-in) or `apikey`. Select the active one per server run with the `TWENTY_CONNECTION` env var; if it is unset, `defaultConnection` is used.

## The `twenty-mcp` CLI

```bash
twenty-mcp setup               # interactive: create/edit connections, set default, sign in
twenty-mcp login <label>       # browser sign-in for an oauth connection
twenty-mcp connections         # list configured connections + signed-in state
twenty-mcp logout <label>      # remove stored tokens for a connection
```

Each server process is bound to one active connection at launch. (Switching connections within a running session is not yet supported.)
