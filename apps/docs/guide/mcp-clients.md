# MCP clients

`twenty-crm-mcp` is a standard stdio MCP server run through `npx`, so it works with any MCP-capable client — the [Installation](/guide/installation) page shows Claude Code and Claude Desktop, and this page covers other agents. Each client stores its MCP config in a different place and format, but the server entry is always the same shape.

## What every client needs

Two things, regardless of client:

1. **The server entry** — spawn `npx` with args `["-y", "twenty-crm-mcp"]` over stdio.
2. **Auth** — passed as environment variables on that entry:
   - **Named connection** (recommended, required for OAuth): `TWENTY_CONNECTION=<label>` for a connection created by [`setup`](/guide/installation#set-up). For an OAuth connection, sign in first with `npx -p twenty-crm-mcp twenty-mcp login <label>` — no secret goes in the MCP config. See [Authentication](/guide/authentication) and [Connections](/guide/connections).
   - **Direct API key**: `TWENTY_BASE_URL=https://crm.example.com` and `TWENTY_API_KEY=<key>` instead of `TWENTY_CONNECTION`.

Add whichever env vars you need to the client's `env` map shown below.

## Quick reference

| Client | Config file | Format | Server map key |
| --- | --- | --- | --- |
| Claude Code / Desktop | `.mcp.json` / `claude_desktop_config.json` | JSON | `mcpServers` |
| Codex | `~/.codex/config.toml` | TOML | `[mcp_servers.<name>]` |
| Cursor | `.cursor/mcp.json` or `~/.cursor/mcp.json` | JSON | `mcpServers` |
| OpenCode | `opencode.json` or `~/.config/opencode/opencode.json` | JSON | `mcp` |
| OpenClaw | `~/.openclaw/openclaw.json` | JSON | `mcp.servers` |
| Pi | `.pi/mcp.json` or `~/.pi/agent/mcp.json` | JSON | `mcpServers` |

## Universal gotchas

- **stdout is reserved for the MCP protocol.** The server already writes all logs and audit output to stderr, so there is nothing to configure — but don't wrap it in a launcher that prints to stdout.
- **Config changes need a reconnect.** A stdio server is spawned once when the client connects. After editing config (or rebuilding a [local dev build](/guide/local-development)), reconnect or restart the client to pick it up.
- **`env` merges with the inherited environment.** Values you set are added on top of the process environment the client already has.

## Claude Code / Claude Desktop

Covered on the [Installation](/guide/installation#point-your-mcp-client-at-the-server) page: add a `twenty-crm` entry under `mcpServers` in `.mcp.json` (Claude Code) or `claude_desktop_config.json` (Claude Desktop). Claude Code also has a one-liner:

```bash
claude mcp add twenty-crm -s user -- npx -y twenty-crm-mcp
```

Set `TWENTY_CONNECTION` (or the direct API-key vars) via `--env`, e.g. `claude mcp add twenty-crm -s user --env TWENTY_CONNECTION=your-label -- npx -y twenty-crm-mcp`.

## Codex

OpenAI's Codex CLI reads TOML from `~/.codex/config.toml`. Each server is an `[mcp_servers.<name>]` table, with env vars in a nested `[mcp_servers.<name>.env]` table:

```toml
[mcp_servers.twenty-crm]
command = "npx"
args = ["-y", "twenty-crm-mcp"]

[mcp_servers.twenty-crm.env]
TWENTY_CONNECTION = "your-label"
```

Or use the CLI (flags go before `--`, the command after):

```bash
codex mcp add twenty-crm --env TWENTY_CONNECTION=your-label -- npx -y twenty-crm-mcp
```

Set `enabled = false` to keep a server defined but off. Config is re-read on the next `codex` invocation. See the [Codex MCP docs](https://developers.openai.com/codex/mcp).

## Cursor

Cursor reads JSON from `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global), under `mcpServers`. Include `type: "stdio"`:

```json
{
  "mcpServers": {
    "twenty-crm": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "twenty-crm-mcp"],
      "env": {
        "TWENTY_CONNECTION": "your-label"
      }
    }
  }
}
```

Cursor interpolates `${env:VAR}` from your system environment inside string values, so you can write `"TWENTY_API_KEY": "${env:TWENTY_API_KEY}"` to avoid hardcoding a key. Toggle servers in **Settings → MCP** without deleting the entry. See the [Cursor MCP docs](https://cursor.com/docs/mcp).

## OpenCode

OpenCode reads JSON from `opencode.json` (project) or `~/.config/opencode/opencode.json` (global). Its schema differs from the others in two ways: `command` is a **single array** holding the executable and its args together, and the env key is **`environment`**, not `env`. Use `type: "local"` for a stdio server:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "twenty-crm": {
      "type": "local",
      "command": ["npx", "-y", "twenty-crm-mcp"],
      "environment": {
        "TWENTY_CONNECTION": "your-label"
      },
      "enabled": true
    }
  }
}
```

`type: "remote"` is a different schema (`url` + `headers`) and does not apply here. Changes require restarting OpenCode. See the [OpenCode MCP docs](https://opencode.ai/docs/mcp-servers/).

## OpenClaw

OpenClaw reads JSON from `~/.openclaw/openclaw.json`, with servers under `mcp.servers`:

```json
{
  "mcp": {
    "servers": {
      "twenty-crm": {
        "command": "npx",
        "args": ["-y", "twenty-crm-mcp"],
        "env": {
          "TWENTY_CONNECTION": "your-label"
        }
      }
    }
  }
}
```

You can also manage servers with the CLI (`openclaw mcp add`, `openclaw mcp reload`, `openclaw mcp doctor --probe`).

::: warning Env safety filter
OpenClaw drops interpreter-control variables (`NODE_OPTIONS`, `PYTHONPATH`, and similar) from a server's `env` as an injection safeguard. This doesn't affect the `TWENTY_*` variables, but don't rely on passing `NODE_OPTIONS` through it.
:::

See the [OpenClaw MCP docs](https://docs.openclaw.ai/cli/mcp).

## Pi

Pi (the `earendil-works/pi` coding agent) reads JSON from `.pi/mcp.json` (project) or `~/.pi/agent/mcp.json` (global), under `mcpServers`. Unlike the others, Pi requires an explicit `transport: "stdio"` field — it is not inferred from `command`:

```json
{
  "mcpServers": {
    "twenty-crm": {
      "command": "npx",
      "args": ["-y", "twenty-crm-mcp"],
      "transport": "stdio",
      "env": {
        "TWENTY_CONNECTION": "your-label"
      }
    }
  }
}
```

Optional `lifecycle` controls when Pi connects: `"lazy"` (default, on first use) or `"eager"` (at startup). See the [Pi docs](https://pi.dev).

## Other clients

Any MCP client that spawns a stdio server can run `twenty-crm-mcp` — map its own config to the [generic pattern above](#what-every-client-needs): command `npx`, args `["-y", "twenty-crm-mcp"]`, plus the `TWENTY_*` env vars. Windsurf, Cline, and Zed all follow a `mcpServers`-style JSON schema close to Cursor's.
