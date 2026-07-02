# Local development

This page covers running the MCP server from a local checkout — building `dist/` and pointing Claude Code (or any [MCP client](/guide/mcp-clients)) at it — for hacking on the server itself. To install the published server, see [Installation](/guide/installation).

Throughout, `<REPO>` is the absolute path to your checkout, e.g. `/Users/you/code/twenty-mcp-suite`.

## Build

```bash
pnpm install
pnpm build
```

`pnpm build` runs `tsup` in every package. The server entry is:

```
packages/twenty-crm-mcp/dist/index.js
```

It's executable (`#!/usr/bin/env node` banner). tsup keeps `twenty-core`, `@modelcontextprotocol/sdk`, and `zod` **external**, so the file imports all three at runtime from the repo's `node_modules` — including the workspace symlink to `twenty-core` (which must be built first; `pnpm build` does this in dependency order). Always launch it by its **absolute path inside the repo** so Node resolves those dependencies; don't copy `dist/index.js` elsewhere.

## Register with Claude Code

Use a **distinct name** (e.g. `twenty-crm-dev`) so a local build doesn't collide with a published `twenty-crm` install:

```bash
claude mcp add twenty-crm-dev -s user -- node <REPO>/packages/twenty-crm-mcp/dist/index.js
```

The `-s` scope controls where the entry is written:

- `-s user` — your user config (`~/.claude.json`); available in every project.
- `-s local` — the current project, private to you (default).
- `-s project` — the project's shared `.mcp.json` (committed). Avoid for a machine-specific absolute path.

The equivalent manual entry (in `~/.claude.json` for user scope, or `.mcp.json` for a project):

```json
{
  "mcpServers": {
    "twenty-crm-dev": {
      "command": "node",
      "args": ["<REPO>/packages/twenty-crm-mcp/dist/index.js"]
    }
  }
}
```

## Auth in dev

The dev build reads the **same** `~/.config/twenty-mcp/connections.json` and encrypted token store as a published install — so an existing OAuth connection just works, with no secrets in the MCP config. The CLI ships as the second bin (`dist/cli-bin.js`, the `twenty-mcp` command):

```bash
# inspect configured connections
node <REPO>/packages/twenty-crm-mcp/dist/cli-bin.js connections
```

Pick a connection by adding `TWENTY_CONNECTION` to the entry's `env` (or via `--env TWENTY_CONNECTION=<label>` on `claude mcp add`). Or skip the registry and pass an API key directly with `TWENTY_BASE_URL` + `TWENTY_API_KEY`. See [Authentication](/guide/authentication).

## Dev loop

Rebuild `dist/` on save:

```bash
pnpm dev   # tsup --watch for twenty-crm-mcp
```

::: warning A stdio server does not hot-reload
The client spawns the server process **once** when it connects and keeps talking to that process. A rebuild changes the files on disk but not the running process — so after `pnpm dev` rebuilds, you must **reconnect** for changes to take effect: run `/mcp` in Claude Code (reconnect the server) or restart the session. This is the single most common local-dev surprise.
:::

## Optional variants

**No build (run TypeScript directly)** — skip `dist/` with `tsx`:

```bash
claude mcp add twenty-crm-dev -s user -- npx tsx <REPO>/packages/twenty-crm-mcp/src/index.ts
```

**Mimic the published invocation** — link the package globally, then register the bin name instead of a path:

```bash
pnpm --filter twenty-crm-mcp link --global
claude mcp add twenty-crm-dev -s user -- twenty-crm-mcp
```

This runs the built `dist/index.js` through the linked `twenty-crm-mcp` bin, matching how the published server is launched.

## See also

- [MCP clients](/guide/mcp-clients) — registering the server with agents other than Claude Code.
- [Installation](/guide/installation) — the published-server path.
