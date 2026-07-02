# AGENTS.md

Canonical guidance for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repository.
`CLAUDE.md` imports this file, so this is the single source of truth.

## What this is

A **schema-adaptable MCP server suite for self-hosted Twenty CRM**, published to npm and run via
`npx` over **stdio** transport. The whole point is resilience to Twenty schema/version changes: tools
are generic and metadata-driven, so a Twenty upgrade, new field, or custom object is handled by a
runtime `refresh_schema` call or a Skill edit — never a code release. Validated against self-hosted
Twenty **v2.17.2**.

## Monorepo layout

pnpm workspaces (`pnpm-workspace.yaml`), Node **>= 22** (native global `fetch`). Two published-shaped
packages plus a docs app:

- **`packages/twenty-core`** — the reusable engine. Transport-agnostic: schema cache, REST/GraphQL
  clients, generic metadata-driven tools, auth (API key + OAuth), connection registry, capability
  profiles, composites, audit. Imports nothing from `twenty-crm-mcp`.
- **`packages/twenty-crm-mcp`** — the CRM **segment**: the stdio MCP server (`src/index.ts`), the
  `twenty-mcp` CLI (`src/cli.ts` / `cli-bin.ts`), the interactive `setup` command (`src/setup.ts`),
  and the `crmProfile` (`src/profile.ts`) that curates which objects/tools are exposed. Depends on
  `twenty-core` via `workspace:*`.
- **`apps/docs`** — VitePress documentation site.

Two bins ship from `twenty-crm-mcp`: `twenty-crm-mcp` → `dist/index.js` (the MCP server) and
`twenty-mcp` → `dist/cli-bin.js` (the CLI).

## Commands

Package manager is **pnpm**, not npm.

- `pnpm build` — build all packages (`pnpm -r build`; each uses tsup → ESM `dist/`)
- `pnpm test` — run all unit tests across packages (`pnpm -r test`; vitest)
- `pnpm dev` — tsup watch for `twenty-crm-mcp`
- `pnpm docs:dev` / `pnpm docs:build` — run/build the VitePress site
- `pnpm --filter twenty-core test` / `pnpm --filter twenty-crm-mcp test` — one package's suite
- `pnpm --filter twenty-core test src/auth/registry.test.ts` — a single test file
- `pnpm --filter twenty-core vitest run -t "resolves by plural"` — tests matching a name

There is no live-integration test suite in-tree (a `test:integration` script was removed);
wire formats flagged **provisional** (see below) are verified manually against a live instance.

### pnpm specifics

- `pnpm-workspace.yaml` carries a supply-chain age guard (`minimumReleaseAge: 1440`) and build-script
  approvals (`allowBuilds` / `onlyBuiltDependencies: esbuild`). Add packages there on
  `ERR_PNPM_IGNORED_BUILDS`.
- Install with **bare `pnpm add <pkg>`** — never `@latest` or a pinned version. Let pnpm pick a safe
  version under the age guard.

## Architecture

**Core principle: tools are mechanism, the profile/Skill is knowledge.** Tools are few, generic, and
parameterized over the live schema — they encode no object or field names, so they rarely change.
Twenty's filter DSL, recipes, and gotchas live in the companion Skill (`packages/twenty-crm-mcp/skill/`,
markdown, edited not released). This split keeps the breakable surface (code) minimal.

**Dependency layers within `twenty-core`** (each imports only from earlier ones):

1. `twenty/errors.ts` — `TwentyApiError`; `isSchemaDriftError(status, body)`; `driftHint(name)`.
2. `twenty/restClient.ts` — thin REST client (Core API for CRUD, Metadata API for schema). Injectable
   `fetchImpl`. `twenty/graphqlClient.ts` — minimal GraphQL client, used **only** for `upsert_records`.
3. `schema/{types,metadata,cache}.ts` — `fetchAllObjects` paginates `/rest/metadata/objects`;
   `SchemaCache` lazy-loads once on first tool call (server starts even if Twenty is down),
   `resolve()` maps an object arg to its plural REST path, `refresh()` reloads.
4. `tools/*.ts` — tool groups returning `ToolDef[]` (`schemaTools`, `readTools`, `writeTools`,
   `upsertTool`). `withDriftHandling` (shared drift wrapper) lives in `tools/helpers.ts`.
5. `auth/*` — credential resolution (see below). `profile/*` — capability profiles. `audit/*` —
   structured audit. `server.ts` — `buildTools`, `createServer`, `createSegmentServer` wire it together.

**Server wiring:** `createSegmentServer(connection, profile, meta)` builds the generic primitives,
runs them through `buildProfileTools` (scoping + business-named aliases), wraps everything in
`withAudit`, and registers the MCP server + a read-only `twenty://schema` resource.

### Authentication & connections

A **connection** is a named Twenty endpoint + credential provider, resolved at server launch by
`resolveActiveConnection(env)`:

- **API key:** `TWENTY_BASE_URL` + `TWENTY_API_KEY` (legacy single-instance), per-connection
  `TWENTY_API_KEY_<LABEL>` env vars, or a key stored encrypted in the token store
  (`twenty-mcp login <label>` / setup). Env vars take precedence over the stored key.
- **OAuth:** public-client authorization-code flow with **PKCE**, **dynamic client registration**
  (RFC 7591), and **endpoint discovery** (RFC 8414) — adapts to the instance automatically. Refresh
  tokens are stored **encrypted (AES-256-GCM)** by `FileTokenStore`; both resolve to a bearer token
  used identically against Twenty.
- **Connection registry:** `~/.config/twenty-mcp/connections.json` (same `.config` layout on
  Windows, under `%USERPROFILE%`; it does **not** use `%APPDATA%`). Path overridable with
  `TWENTY_MCP_CONFIG`, base dir with `XDG_CONFIG_HOME`. `defaultConfigDir(env)` and
  `connectionsPath(env)` in `twenty-core` are the single source of truth for these paths — always
  use them rather than re-deriving the path inline. `TWENTY_CONNECTION` picks the active label;
  otherwise `defaultConnection`.

The **`twenty-mcp` CLI** manages this: `setup` (interactive TUI over `@clack/prompts` —
add/edit/remove/set-default sites, offer OAuth sign-in), `login <label>`, `connections`,
`logout <label>`. The registry file **never stores secrets** — API keys live in env vars or the
encrypted token store, OAuth tokens in the encrypted store.

### Capability profiles

A `CapabilityProfile` (e.g. `crmProfile`) has an `objectScope` (which objects the segment may touch)
and a `tools` list that both re-exposes generic tools and adds **bound business-named aliases**
(e.g. `find_contacts` = `query_records` bound to `object: "people"`; `get_contact_brief` =
`get_record` bound to `object: "people", depth: 1`). Scoping is a **curation** feature, not a security
boundary — it limits the addressed object, not related ids inside record bodies, and `search` is
intentionally unscoped.

## Conventions that bite

- **ESM with `.js` import extensions.** `moduleResolution: Bundler`, but local `.ts` imports still use
  the `.js` extension (`import { x } from "./version.js"`). Cross-package imports use the bare name
  (`from "twenty-core"`); `twenty-core` re-exports via **explicit named exports** in `src/index.ts` —
  add each new public symbol there.
- **stdout is reserved for the MCP protocol.** All logging/diagnostics go to `console.error` (stderr).
  This is why audit output is stderr-only. The CLI is a standalone process and may use stdout freely.
- **REST-first.** Record CRUD and schema use REST; GraphQL is only for batch upsert.
- **Writes are batch-native.** Write tools always take an array of 1–60 records; a single write is a
  one-element array. No separate single/batch variants.
- **Schema drift is handled manually, never auto-healed.** On a drift-shaped error (404, or a 400
  whose body matches schema-keyword patterns in `errors.ts`) a tool rethrows a message that explicitly
  names `refresh_schema`; the model decides to refresh and retry. Detection is deliberately narrow so
  data-validation 400s aren't misrouted.
- **Provisional wire formats:** the `search` path and the `upsert_records` GraphQL mutation shape are
  marked provisional in code/README — confirm against a live instance before relying on them.
- **Tests inject fakes, never hit the network.** `RestClient`/`GraphQLClient` take a `fetchImpl`,
  `SchemaCache` takes a loader, the CLI/`setup` take injected deps (`CliDeps`/`SetupDeps`, with a
  scripted fake `PromptAPI`). Tool handlers return JSON strings; assert by `JSON.parse`-ing the result.

## Workflow & status

Built task-by-task via the superpowers SDD workflow (TDD-first). Design specs live in
`docs/superpowers/specs/`, implementation plans in `docs/superpowers/plans/`, and durable progress in
`.superpowers/sdd/progress.md` (the ledger of what each plan/task delivered and the carried-forward
review findings — read it to understand history and open follow-ups). When implementing from a plan,
follow its task section: failing test first, then implementation, then the commit message it gives.

The CRM segment is complete and live-verified (resilient core, OAuth + API-key auth + encrypted token
store + CLI, capability-scoped curated tools, depth composites, stderr audit).
