# Design: non-interactive (flag-driven) `twenty-mcp setup`

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan
**Issue:** #15 — Non-interactive setup (flag-driven: `setup --add <label> --url ...`)

## Problem

`twenty-mcp setup` is interactive-only: it drives an `@clack/prompts` TUI (see
`2026-07-01-setup-command-design.md`). That is unusable for scripting and CI, where there
is no terminal to drive. A flag-driven, non-interactive mode lets a script register,
edit, remove, or default a connection — and install the companion skill — without the TUI.

The connection-registry mutators this needs already exist in `twenty-core`
(`upsertConnection`, `removeConnection`, `setDefaultConnection`, `saveRegistryFile`), so
this feature is a CLI parsing + wiring layer on top of them. No `twenty-core` change.

## Scope

Full parity with the interactive menu, one action per invocation:

- **add** a site
- **edit** a site
- **remove** a site
- **set default** connection
- **install** the companion skill

## Invocation model

- **Bare `twenty-mcp setup`** → unchanged interactive TUI (`runSetup`).
- Presence of any recognized **action flag** (`--add`, `--edit`, `--remove`,
  `--set-default`, `--install-skill`) → **non-interactive mode**.
- **Exactly one action per invocation.** Two action flags together is a parse error
  (exit 1). This keeps parsing, testing, and script reasoning simple.

### Flags per action

| Action | Flags |
|---|---|
| add | `--add <label> --url <url> --auth <oauth\|apikey>` |
| edit | `--edit <label> [--url <url>] [--auth <oauth\|apikey>] [--label <new-label>]` |
| remove | `--remove <label> [--purge-credentials]` |
| set default | `--set-default <label>` |
| install skill | `--install-skill --scope <project\|user>` |

`--url`, `--auth`, `--label`, `--scope`, `--purge-credentials` are modifiers; they are
meaningful only alongside the action flag that consumes them. An unknown flag, or a
modifier without its action, is a parse error.

## Per-action behavior

- **add** — Error (exit 1) if `<label>` already exists; the explicit path to change an
  existing site is `--edit`. Otherwise `upsertConnection` + `saveRegistry`. Then:
  - `--auth oauth`: record only. Print `Run: twenty-mcp login <label>` — the browser
    sign-in flow is interactive by nature and cannot run in CI. Preserves the invariant
    that no secret is ever written to `connections.json`.
  - `--auth apikey`: print the exact env var to set (`TWENTY_API_KEY_<LABEL>`, fallback
    `TWENTY_API_KEY`).
- **edit** — Error if `<label>` is not present. Only the provided modifier flags change;
  omitted fields are preserved. `--label <new>` renames = `removeConnection(old)` +
  `upsertConnection(new)`; if the old label was `defaultConnection`, move the default to
  the new label. If the renamed site was `auth: oauth`, print a hint to re-run
  `twenty-mcp login <new-label>` (the stored token is keyed by the old label). Persist
  once via `saveRegistry`.
- **remove** — Error if `<label>` is not present. `removeConnection` + `saveRegistry`.
  If `--purge-credentials` is set **and** a stored token exists for that label,
  `store.delete(label)`.
- **set default** — Error if `<label>` is not present. `setDefaultConnection` +
  `saveRegistry`.
- **install skill** — `--scope` is required (no interactive scope prompt to fall back
  on). `skill.install(sourceDir, dest)` for the chosen scope, **overwriting silently**
  (the non-interactive contract is "do what I said"). Print the destination path.

Every mutation is followed by printing the resulting connections (same one-line-per-site
formatting the interactive `Done` step and the `connections` command use), so a script
sees the post-state.

## Architecture

All new code lives in `packages/twenty-crm-mcp`. Two units, plus one `cli.ts` branch.

### `src/setup.ts` — parser + non-interactive runner (new exports)

1. **`parseSetupArgs(args: string[]): SetupCommand | { error: string }`** — pure,
   no I/O, unit-testable. `SetupCommand` is a discriminated union on `kind`:

   ```ts
   type SetupCommand =
     | { kind: "interactive" }
     | { kind: "add"; label: string; url: string; auth: "oauth" | "apikey" }
     | { kind: "edit"; label: string; url?: string; auth?: "oauth" | "apikey"; newLabel?: string }
     | { kind: "remove"; label: string; purgeCredentials: boolean }
     | { kind: "set-default"; label: string }
     | { kind: "install-skill"; scope: "project" | "user" };
   ```

   Validation (returns `{ error }` on any failure): at most one action flag; required
   modifiers present (`add` needs `--url` + `--auth`; `install-skill` needs `--scope`);
   `--url` passes `isHttpUrl`; `label` / `newLabel` match `LABEL_RE`; `auth` ∈
   `{oauth, apikey}`; `scope` ∈ `{project, user}`; no unknown flags; no modifier without
   its action. `edit` with no modifier flags is an error (nothing to change). No args →
   `{ kind: "interactive" }`.

2. **`runSetupNonInteractive(cmd: SetupCommand, deps: SetupDeps): Promise<number>`** —
   executes a non-`interactive` command against the existing `SetupDeps` (the `prompts`
   field is simply unused). Reuses `upsertConnection` / `removeConnection` /
   `setDefaultConnection` / `deps.saveRegistry` / `deps.store` / `deps.skill.install`.
   Emits via `deps.out` / `deps.err`, returns `0` on success, `1` on a runtime error
   (e.g. add-existing, edit/remove/set-default of a missing label). No clack; no prompts.

   Reuses the existing `isHttpUrl`, `LABEL_RE`, `envKeyForLabel`, and the
   `printConnections` helper already in this module.

### `src/cli.ts` — one branch change

The `setup` branch becomes:

```ts
if (cmd === "setup") {
  const parsed = parseSetupArgs(argv.slice(1));
  if ("error" in parsed) { deps.err(parsed.error); return 1; }
  if (parsed.kind === "interactive") return deps.runSetup();
  return deps.runSetupNonInteractive(parsed);  // wired in realDeps
}
```

`CliDeps` gains `runSetupNonInteractive: (cmd) => Promise<number>`, wired in `realDeps`
to `runSetupNonInteractive(cmd, realSetupDeps(env))`. This keeps `runCli` injectable and
network-free for tests, consistent with the existing `runSetup` wiring. `USAGE` is
extended to document the non-interactive form.

## Error handling

- **Parse errors** → `deps.err(message)` + exit 1. Messages name the offending flag and,
  where useful, the fix (e.g. `--add requires --url and --auth`; `"<label>" already
  exists — use --edit to change it`).
- **Runtime errors** (missing label on edit/remove/set-default, add-existing) →
  `deps.err` + exit 1, no partial write (mutators are pure; `saveRegistry` runs only
  after a fully validated mutation).
- **File write errors** propagate as thrown `Error`s, reported by the existing
  `cli-bin.ts` catch (stderr, exit 1) — unchanged.

## Testing

- **`parseSetupArgs` (pure):** each action parses to the right union member; `add`
  missing `--url`/`--auth` errors; two action flags error; unknown flag errors; modifier
  without action errors; bad url / label / auth / scope error; `edit` with no modifiers
  errors; no args → `interactive`.
- **`runSetupNonInteractive` (fake deps, no network):**
  - add-apikey writes the registry, prints the env-var hint, does **not** call `login`.
  - add-oauth writes the registry, prints the login hint, does **not** call `login`.
  - add-existing returns 1 and does not write.
  - edit changes only provided fields; rename moves `defaultConnection` and prints the
    oauth re-login hint.
  - remove deletes the entry; `--purge-credentials` calls `store.delete` (and only when a
    token exists); missing label returns 1.
  - set-default sets the field; missing label returns 1.
  - install-skill calls `skill.install` to the chosen scope and prints the path.
- **`cli.test.ts`:** `setup` with an action flag dispatches to `runSetupNonInteractive`;
  bare `setup` dispatches to `runSetup`; a parse error returns 1.

Mirrors the deps-injection / scripted-fake approach already used in `setup.test.ts` and
`cli.test.ts`.

## Out of scope (YAGNI)

- OAuth browser sign-in in non-interactive mode (record-only; `login` stays separate).
- Chaining multiple actions in one invocation.
- Any change to `twenty-core`, `resolveActiveConnection`, or the MCP server runtime.
