# Connections & multi-instance

Connections let you register one or more Twenty instances and pick which one a server run targets — useful if you manage several instances (production and staging, or multiple orgs).

## The registry

Create `~/.config/twenty-mcp/connections.json`:

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
twenty-mcp login <label>       # browser sign-in for an oauth connection
twenty-mcp connections         # list configured connections + signed-in state
twenty-mcp logout <label>      # remove stored tokens for a connection
```

Each server process is bound to one active connection at launch. (Switching connections within a running session is not yet supported.)
