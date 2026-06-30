# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A version-resilient MCP server for self-hosted Twenty CRM, published to npm and run via `npx`
over **stdio** transport. The whole point is resilience to Twenty schema/version changes: tools
are generic and metadata-driven, so a Twenty upgrade, new field, or custom object is handled by a
runtime `refresh_schema` call or a Skill edit — never a code release.

Validated against self-hosted Twenty v2.17.2. Config is env-only: `TWENTY_BASE_URL`,
`TWENTY_API_KEY`.

## Commands

Package manager is **pnpm**, not npm (per user standard). Node >= 20 (native global `fetch`).

- `pnpm build` — bundle to `dist/index.js` via tsup (ESM, shebang banner)
- `pnpm dev` — tsup watch
- `pnpm test` — run all unit tests (vitest, `src/**/*.test.ts`)
- `pnpm test:watch` — vitest watch
- `pnpm test src/tools/schemaTools.test.ts` — run a single test file
- `pnpm vitest run -t "resolves by plural"` — run tests matching a name
- `pnpm test:integration` — env-gated tests against a live Twenty (`vitest.integration.config.ts`; added in Task 13, see below)

### pnpm specifics

- `pnpm-workspace.yaml` carries the supply-chain age guard (`minimumReleaseAge: 1440`) and build-script
  approvals (`allowBuilds`/`onlyBuiltDependencies: esbuild`). Add packages here on `ERR_PNPM_IGNORED_BUILDS`.
- Install with bare `pnpm add <pkg>` — never `@latest`. Let pnpm pick a safe version under the age guard.

## Architecture

**Core principle: tools are mechanism, the Skill is knowledge.** Tools are few, generic, and
parameterized over the live schema — they encode no object or field names, so they rarely change.
Twenty's filter DSL, recipes, and gotchas live in a companion Claude Code Skill under `skill/`
(markdown, edited not released). This split is what keeps the breakable surface (code) minimal.

Dependency layers (each imports only from earlier ones):

1. `src/config.ts` — `loadConfig(env)` → `TwentyConfig`; normalizes `baseUrl`, throws actionable errors.
2. `src/twenty/errors.ts` — `TwentyApiError`; `isSchemaDriftError(status, body)`; `driftHint(name)`.
3. `src/twenty/restClient.ts` — thin REST client (Core API for CRUD, Metadata API for schema). Injectable `fetchImpl` for tests.
4. `src/twenty/graphqlClient.ts` — minimal GraphQL client, used **only** for `upsert_records` (Task 10).
5. `src/schema/{types,metadata}.ts` — `ObjectSchema`/`FieldSchema`; `fetchAllObjects(rest)` paginates `/rest/metadata/objects` and normalizes (drops inactive objects/fields).
6. `src/schema/cache.ts` — `SchemaCache`: lazy-loaded once on first tool call (so the server starts even if Twenty is down), `resolve()` maps an object arg to its plural REST path, `refresh()` reloads.
7. `src/tools/*.ts` — tool groups returning `ToolDef[]`. `ToolDef` is defined and exported from `schemaTools.ts`; other tool modules import it. `withDriftHandling` (shared drift wrapper) lives in `helpers.ts`.
8. `src/index.ts` — server wiring (currently a stub; Task 11).

### Conventions that bite

- **ESM with `.js` import extensions.** TypeScript is `moduleResolution: Bundler`, but imports of local
  `.ts` files still use the `.js` extension (e.g. `import { x } from "./version.js"`). Match this.
- **stdout is reserved for the MCP protocol.** All logging/diagnostics go to `console.error` (stderr).
- **Never log or echo `TWENTY_API_KEY`.** Committed fixtures must contain no real PII or tokens.
- **Schema drift is handled manually, never auto-healed (v1).** On a drift-shaped error a tool rethrows
  a message that explicitly names `refresh_schema`; the model decides to refresh and retry. Drift detection
  is deliberately narrow (404, or 400 whose body matches schema-keyword patterns in `errors.ts`) so
  data-validation 400s aren't misrouted. The exact live wording is verified in Task 13 — tighten there.
- **REST-first.** Record CRUD and schema use REST; GraphQL is only for batch upsert.
- **Writes are batch-native.** Write tools always take an array of 1–60 records; a single write is a
  one-element array. No separate single/batch variants.

### Tool surface (target ~10)

Schema: `list_object_types`, `describe_object`, `refresh_schema`.
Read: `query_records`, `get_record`, `search`. Write (REST batch): `create_records`, `update_records`,
`delete_records`. Write (GraphQL): `upsert_records`. Plus a read-only schema MCP resource.

## Workflow & status

This repo is built task-by-task via the superpowers SDD workflow (TDD-first). The authoritative
plan is `docs/superpowers/plans/2026-06-30-twentycrm-mcp.md` (14 tasks); the design rationale is in
`docs/superpowers/specs/`. Progress is tracked in `.superpowers/sdd/progress.md`.

**Tasks 1–7 are complete** (scaffolding, config, errors, REST client, schema metadata/cache, schema
tools). **Remaining: Task 8** read tools, **9** write tools, **10** GraphQL client + upsert, **11**
schema resource + server wiring (`index.ts` is still a stub), **12** companion Skill, **13** env-gated
integration smoke test (the source of truth for wire formats: `search` path, upsert mutation name/casing,
batch endpoints), **14** README + publish prep.

When implementing a remaining task, follow its plan section: write the failing test first, then the
implementation, then commit with the message given in the plan.

### Test pattern

Tests inject fakes rather than hitting the network: `RestClient`/`GraphQLClient` take a `fetchImpl`,
and `SchemaCache` takes a loader — e.g. `new SchemaCache({} as any, vi.fn().mockResolvedValue([people]))`.
Tool handlers are async and return JSON strings; assert by `JSON.parse`-ing the result.
