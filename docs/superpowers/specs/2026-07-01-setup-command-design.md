# Design: `twenty-mcp setup` — interactive connection-registry command

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan

## Problem

The connection registry (`~/.config/twenty-mcp/connections.json`) is the source of
truth for which Twenty sites the MCP server can reach. Today it is **read-only from the
tooling's perspective**: `resolveActiveConnection` and the `login` / `connections` /
`logout` CLI commands all read it, but nothing writes it. Users must hand-edit the JSON
to add a site, which is error-prone and undocumented.

`setup` fills that gap: an interactive, cross-platform (Windows + macOS) TUI that creates
the registry and lets the user add, edit, remove, and default sites without touching JSON.

## Registry file shape (existing, unchanged)

```jsonc
{
  "defaultConnection": "acme",            // optional
  "connections": {
    "acme":   { "baseUrl": "https://crm.acme.com", "auth": "oauth" },
    "sandbox":{ "baseUrl": "https://crm.dev.acme.com", "auth": "apikey", "env": "…" }
  }
}
```

`setup` reads and writes exactly this shape (`RegistryFile` / `ConnectionConfig` from
`twenty-core/src/auth/registry.ts`). No schema change.

## Credential policy (unchanged by this feature)

- **OAuth sites:** credentials are obtained by the existing `loginConnection` browser
  flow and stored encrypted in the `FileTokenStore`. `setup` never stores secrets in the
  registry; it only records the site and *optionally invokes login*.
- **API-key sites:** the key is resolved at runtime from the environment
  (`TWENTY_API_KEY_<LABEL>`, falling back to `TWENTY_API_KEY`). `setup` records the site
  and prints the exact env var name to set. It does **not** store the key.

This preserves the current invariant that no secret is ever written to `connections.json`.

## Architecture

Follows the existing split: `twenty-core` = mechanism (pure, I/O-light, unit-tested);
`twenty-crm-mcp` = CLI wiring (dependency-injected, thin).

### `twenty-core/src/auth/registry.ts` — pure mutators (new)

- `saveRegistryFile(path: string, reg: RegistryFile): void`
  - `mkdir -p` the containing dir, write pretty JSON with mode `0600` (mirrors token-store
    file hygiene). Counterpart to the existing `loadRegistryFile`.
- `upsertConnection(reg, label, cfg): RegistryFile` — add or replace a connection,
  returning a new object (does not mutate input).
- `removeConnection(reg, label): RegistryFile` — remove a connection; if the removed label
  was `defaultConnection`, clear `defaultConnection`.
- `setDefaultConnection(reg, label): RegistryFile` — set `defaultConnection` (label must
  already exist; callers guarantee this).

These are pure and independently unit-testable with no prompts and no network.

### `twenty-crm-mcp/src/setup.ts` — interactive orchestration (new)

```ts
interface SetupDeps {
  prompts: PromptAPI;                 // thin wrapper over @clack/prompts (see below)
  loadRegistry(): RegistryFile | null;
  saveRegistry(reg: RegistryFile): void;
  store: TokenStore;
  login: typeof loginConnection;
  out(msg: string): void;
  err(msg: string): void;
}

export async function runSetup(deps: SetupDeps): Promise<number>;
```

`PromptAPI` is a minimal interface (`text`, `select`, `confirm`, `isCancel`, `intro`,
`outro`, `note`) so tests can inject a scripted fake and never touch a real terminal. The
real implementation wraps `@clack/prompts`.

`realSetupDeps(env)` builds the production deps: `FileTokenStore` + `defaultConfigDir`,
config-path resolution identical to `cli.ts`'s `realDeps`
(`TWENTY_MCP_CONFIG?.trim() ?? join(dir, "connections.json")`), `loginConnection`, and a
`saveRegistry` bound to that path.

### `twenty-crm-mcp/src/cli.ts` — one new branch

- Add `if (cmd === "setup") return runSetup(realSetupDeps(env));`.
- Extend `USAGE` to include `setup`.

### Dependency

- Add `@clack/prompts` to `twenty-crm-mcp` via bare `pnpm add @clack/prompts` (age guard
  picks the version). Pure-JS, cross-platform. Confirmed `1.6.0` (2026-06-19) clears the
  1440-minute `minimumReleaseAge` guard.

## Interactive flow

`setup` loads the existing registry (or starts from `{ connections: {} }`) and runs a
main-menu loop. **The registry is persisted to disk after every mutation**, so a mid-session
cancel never loses prior work.

Main menu (`select`):

1. **Add a site**
   - `label` — `text`, validated: non-empty, matches `^[a-z0-9-]+$`, not already present.
   - `baseUrl` — `text`, validated as a parseable `http(s)` URL.
   - `auth` — `select`: `apikey` | `oauth`.
   - Persist via `upsertConnection` + `saveRegistry`.
   - If `oauth`: `confirm` "Sign in now?" → run `login({ label, baseUrl, store })`.
     On failure, show the error via `err` but keep the site recorded (user can
     `twenty-mcp login <label>` later).
   - If `apikey`: `note` the exact env var to set: `TWENTY_API_KEY_<LABEL>`
     (or `TWENTY_API_KEY`).
2. **Edit a site** — `select` an existing label → edit `baseUrl` / `auth` / `label`
   (renaming a label is remove-old + upsert-new; if it was default, move default too).
3. **Remove a site** — `select` → `confirm` → `removeConnection` + `saveRegistry`.
   If a stored OAuth token exists for that label, `confirm` "Also remove stored
   credentials?" → `store.delete(label)`.
4. **Set default connection** — `select` from existing labels → `setDefaultConnection`.
5. **Done** — print the resulting connections (same formatting as the `connections`
   command: `label  (auth, baseUrl)  — <state>`) and exit `0`.

## Error handling

- **Validation** re-prompts inline via clack `validate` callbacks (bad URL,
  empty/duplicate/malformed label).
- **Cancel** (Ctrl-C / Esc): every prompt result is checked with `isCancel`; on cancel,
  print a brief message and return `0` without a partial/corrupt write (writes only happen
  through the pure mutators after a complete, valid answer).
- **Login failure** is caught; the site remains recorded; message surfaced via `err`.
- **File write errors** propagate as thrown `Error`s and are reported by the existing
  `cli-bin.ts` catch (message to stderr, exit 1).

## Testing

- **Core (vitest, tmp dir):**
  - `saveRegistryFile` → `loadRegistryFile` round-trip; directory is created; file mode.
  - `upsertConnection` adds and replaces; input not mutated.
  - `removeConnection` deletes and clears `defaultConnection` when it pointed at the
    removed label.
  - `setDefaultConnection` sets the field.
- **crm-mcp (`setup.test.ts`):** `runSetup` with a scripted fake `PromptAPI` sequence and
  fake `store` / `login` / `saveRegistry`:
  - Add-oauth-then-sign-in writes the expected registry and calls `login` with the right
    args.
  - Add-apikey notes the env var and does not call `login`.
  - Remove deletes from the registry (and calls `store.delete` when confirmed).
  - Cancel mid-flow returns 0 and does not corrupt the registry.
  - Mirrors the deps-injection approach already used in `cli.test.ts`.

## Out of scope (YAGNI)

- Storing API keys in the encrypted token store (runtime still reads keys from env only).
- Non-interactive/flag-driven `setup` (e.g. `setup --add label --url …`) — can be added
  later if scripting demand appears.
- Any change to `resolveActiveConnection` or the MCP server runtime.
