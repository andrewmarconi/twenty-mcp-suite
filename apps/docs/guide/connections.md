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
- For an **API-key** site, either store the key **encrypted** right away (masked prompt) or read it from the environment — declining prints the exact variable to set (`TWENTY_API_KEY_<LABEL>`).

Changes are saved after each step, so quitting partway through keeps what you already added. **No secrets are written to the registry** — API keys live in your environment or the encrypted token store, and OAuth tokens are stored encrypted separately (see [Authentication](/guide/authentication)).

## Non-interactive (scripting / CI)

Every action the interactive menu offers is also available as a single flag-driven command, useful for scripting or CI. Exactly one action flag is allowed per invocation:

```bash
twenty-mcp setup --add <label> --url <url> --auth <oauth|apikey>
twenty-mcp setup --edit <label> [--url <url>] [--auth <oauth|apikey>] [--label <new-label>]
twenty-mcp setup --remove <label> [--purge-credentials]
twenty-mcp setup --set-default <label>
twenty-mcp setup --install-skill --scope <project|user>
```

- `--add` with `--auth oauth` records the site only and prints a `twenty-mcp login <label>` hint — the browser sign-in flow does not run in non-interactive mode, so it works unattended in CI. Run `twenty-mcp login <label>` separately once you need a token.
- `--add` with `--auth apikey` prints the `TWENTY_API_KEY_<LABEL>` env var to set (falls back to `TWENTY_API_KEY`). No secret is ever written to the registry — and none is accepted on argv; to store a key encrypted instead, run the interactive `twenty-mcp login <label>`.
- `--install-skill` overwrites an existing skill without prompting.
- `--remove` with `--purge-credentials` also deletes any stored credential for that label (OAuth tokens or a stored API key), not just the registry entry.

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
twenty-mcp login <label>       # browser sign-in (oauth) or masked API-key entry (apikey)
twenty-mcp connections         # list configured connections + signed-in state
twenty-mcp logout <label>      # remove stored credentials for a connection
```

Each server process is bound to one active connection at launch. (Switching connections within a running session is not yet supported.)
