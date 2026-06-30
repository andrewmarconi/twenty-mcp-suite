# Twenty Suite Foundation + CRM Segment — Design

**Date:** 2026-06-30
**Status:** Approved (design); pending spec review before planning
**Scope:** Spec 1 of the modular suite — the reusable foundation (`twenty-core`) plus the CRM segment as its first consumer. Ops, Analytics, and Data segments are each their own later spec → plan → build cycle.
**Source material:** `docs/twenty-mcp-prd.md`, `docs/gaps.md`, `docs/family.md`, and the v1 design in `docs/superpowers/specs/2026-06-30-twentycrm-mcp-design.md`.

## Summary

This evolves the v1 single-server Twenty CRM MCP into a modular suite without abandoning v1's core bet. v1's thesis — *few generic, schema-driven tools are the stable mechanism; a companion Skill carries the volatile knowledge* — is preserved and becomes the engine of `twenty-core`. Segments layer role-scoped, business-level capability on top, expressed as declarative configuration rather than hand-written tools, so a Twenty upgrade still almost never forces a code release.

This spec covers the foundation shared by all four planned segments, plus the CRM segment built on it. The CRM segment needs no new handler code: it is a capability profile plus a few declarative recipes.

## Locked decisions

1. **Relationship to v1: layer on top.** Keep the adaptable-schema generic engine as the core; segments scope on top of it. (Chosen from: layer-on-top / replace / coexist-as-peers.)
2. **Three layers.** `core` (raw transport + schema cache + generic schema-driven primitives exposed as tools) + a capability-profile loader + a recipe runner. A segment = `{ profile manifest, recipe manifests, and handler code only when a genuinely new primitive is required }`.
3. **Raw REST/GraphQL is internal substrate only** — never a model-facing tool. The model only ever sees curated, named tools. This is what makes least-privilege and capability gating mean something.
4. **Packaging: monorepo now** (`packages/twenty-core` + per-segment packages), per the PRD's target layout.
5. **Auth: a connection registry with pluggable credential providers.** OAuth Authorization-Code + PKCE is preferred (acts as the signed-in user, inheriting that user's Twenty role); static API key is kept as the no-friction fallback. Both resolve to one internal contract, `getBearer()`.
6. **Multi-instance = named connections** in that registry; the active connection is selected only from the pre-registered set, never an arbitrary URL injected by the model.
7. **Deployment: single-operator local** (stdio + `npx` + local token store). No hosted multi-user / HTTP-transport mode in this cycle.

## Why this resolves the central tension

The PRD's representative tools (`get_contact_brief`, `update_opportunity_stage`, `get_pipeline_summary`) read as the opposite of v1's "encode no object or field names" rule. Classifying them shows three buckets, and only one threatens resilience:

- **Scoping** (`find_contacts`, `create_followup_task`) — narrowed views of primitives that already exist. Zero schema in code.
- **Composites / recipes** (`get_contact_brief`, `append_note`) — multi-step flows that assume relations. Only a risk if the assumption is hardcoded *in TypeScript*.
- **New primitives** (aggregation, health, export) — genuinely new low-level code.

The resolution: the semantic layer is **declarative, not hand-coded**. Scoping is a capability profile; composites are recipe manifests resolved at runtime against the live schema (degrading gracefully when a relation is absent). Hand-written code is reserved for genuinely new primitives. Resilience is intact because nothing volatile lives in compiled code.

## Architecture & repo layout

A pnpm monorepo. `twenty-core` carries everything reusable; segment packages are thin compositions. v1's existing clients, schema cache, and generic tools migrate into `twenty-core` largely intact — a behavior-preserving restructure, not a rewrite.

```text
packages/
  twenty-core/                 # reusable engine — no MCP server of its own
    src/
      transport/               # raw REST + GraphQL clients (internal only)
      auth/                    # connection registry, credential providers (apikey|oauth), token store
      schema/                  # metadata fetch + cache (from v1)
      primitives/              # generic schema-driven ops: query/get/search/CRUD/upsert + expand (+ aggregate, later)
      profile/                 # capability-profile loader + enforcement
      recipes/                 # recipe runner (declarative composites over primitives)
      audit/                   # structured tool-invocation logging
  twenty-crm-mcp/              # Segment 1: registers core + loads the CRM profile + CRM recipes
    src/index.ts               # server wiring (stdio)
    profile.ts                 # CRM capability profile
    recipes/                   # get_contact_brief, get_account_snapshot, update_opportunity_stage (declarative)
  shared-test-fixtures/        # committed schema fixtures — no PII or tokens
# Later cycles add: apps/smoke-client, packages/twenty-ops-mcp, twenty-analytics-mcp, twenty-data-mcp
```

## Connection & auth layer (`twenty-core/src/auth/`)

The one genuinely new subsystem. Everything above it depends on a single internal contract: `getBearer(): Promise<string>` — a valid, auto-refreshed token. No layer above auth knows whether the token came from an API key or OAuth.

**Connection registry.** A local config file (e.g. `~/.config/twenty-mcp/connections.json`) holds named connections with *non-secret* metadata only. The operator's multiple Twenty instances become multiple entries.

```jsonc
{
  "defaultConnection": "acme-prod",
  "connections": {
    "acme-prod":  { "baseUrl": "https://crm.acme.com",  "env": "prod",  "auth": "oauth"  },
    "acme-stage": { "baseUrl": "https://stage.acme.com", "env": "stage", "auth": "oauth"  },
    "side-gig":   { "baseUrl": "https://crm.other.com",  "env": "prod",  "auth": "apikey" }
  }
}
```

**Credential providers** (both implement `getBearer()`):

- **`apikey`** — static bearer from the token store. v1's mode; zero setup beyond pasting a key.
- **`oauth`** — Authorization Code + PKCE via a **loopback redirect** (`http://localhost:<port>/callback`), the standard native-app pattern. Core opens the browser to `/oauth/authorize`, captures the code, exchanges at `/oauth/token`, persists the refresh token, and silently refreshes on expiry. The token acts as the signed-in user.

**Token store.** OS keychain when available, AES-256-GCM encrypted-file fallback under the config dir, keyed by connection label. Refresh tokens and API keys live only here — never in the registry JSON, never logged.

**Active-connection selection**, constrained to the registered set:

- *Launch-time (primary):* `TWENTY_CONNECTION=<label>` env var, or the registry's `defaultConnection`. One process = one active connection.
- *In-session `switch_connection` tool (optional, per-profile):* accepts only a known label — never a URL or credentials — so the model can move between the operator's registered instances but cannot reach anything not pre-authorized.

**Setup CLI** (keeps the interactive OAuth dance out of the MCP session): `twenty-mcp login <label>`, `twenty-mcp connections`, `twenty-mcp logout <label>`. By the time the server runs, a valid refresh token already exists.

**How access level flows.** With an `oauth` connection the token *is* the user, so object/field/row permissions are whatever Twenty grants that user, enforced server-side by Twenty. The capability profile only curates the tool surface on top. There is no separate access-level configuration; identity carries it.

**Twenty support (verified via docs).** Twenty exposes OAuth 2.0 Authorization Code with PKCE (`/oauth/authorize`, `/oauth/token`, refresh) and the resulting bearer token is used identically to an API key against `/rest/...`. Twenty roles can also be assigned to API keys and AI agents, with object-level (complete), field-level (rolling out), and row-level permissions. Sources: https://docs.twenty.com/developers/extend/oauth, https://docs.twenty.com/developers/extend/api, https://docs.twenty.com/user-guide/permissions-access/capabilities/permissions.

## Core primitives & transport contract

**Internal transport** (`transport/`). Two raw clients fed by `getBearer()`: `rest.request(method, path, { query, body })` and `graphql.request(query, variables)`. They carry pagination, retries, and normalized errors (from v1), are the only code that touches the network, and are never exposed as tools.

**Generic schema-driven primitives** (`primitives/`) — the tools the model sees, all parameterized over the live schema (no hardcoded object/field names):

- Read: `query_records`, `get_record`, `search`.
- Write (REST batch, 1–60, array-native): `create_records`, `update_records`, `delete_records`.
- Write (GraphQL): `upsert_records`.
- **`expand`** (new): given a record and desired relations, follow whichever relations actually exist in the live schema and inline them; silently skip absent ones. This is the substrate recipes use for composites, and the reason composites stay resilient.
- **`aggregate`** (new, **deferred to the Analytics cycle**): generic group-by/count/sum over any object+field. Seam defined now; not built in Spec 1 (CRM does not need it).

**Schema cache & drift** (`schema/`) — unchanged from v1: lazy-loaded once, `resolve()` maps an object arg to its plural REST path, `refresh()` reloads. Drift stays manual: a drift-shaped error rethrows a message naming `refresh_schema`; the model refreshes and retries. No auto-heal.

**Primitive → tool registration.** A primitive is defined once in core as a `ToolDef` (handler + schema + description) and is *not* auto-registered. A segment's profile decides which primitives to expose, under what names/descriptions, and with what scoping.

## Profile + recipe engine

**Capability profile** (`profile/`). A declarative manifest a segment loads. None of it hardcodes schema.

```jsonc
// twenty-crm-mcp/profile.ts (illustrative)
{
  "name": "crm",
  "expectedRole": "sales",            // warns if the active connection's token exceeds this
  "exposeSwitchConnection": true,
  "objectScope": ["people", "companies", "opportunities", "tasks", "notes"],
  "tools": [
    { "from": "query_records",  "as": "find_contacts",  "bind": { "object": "people" },
      "description": "Search people in the CRM." },
    { "from": "query_records",  "as": "find_companies", "bind": { "object": "companies" } },
    { "from": "create_records", "as": "create_followup_task", "bind": { "object": "tasks" } },
    { "from": "update_records", "as": "update_record" }   // generic, but scoped to objectScope
  ],
  "readOnly": false
}
```

- **Object scope** — resolved against the live schema; a primitive call touching an out-of-scope object is refused before it reaches Twenty.
- **Tool exposure & aliasing** — choose which primitives appear, rename to business language, optionally `bind` an argument (object locked to `people` → `find_contacts`). The model sees a short, role-appropriate list; underneath it is the same generic primitive.
- **read-only / expectedRole** — `readOnly` disables writes for analytics-style sessions; `expectedRole` cross-checks the active connection so an over-privileged token on a CRM profile warns rather than silently granting power.

**Recipe** (`recipes/`). A declarative composite expressed as steps over primitives, not TypeScript per tool.

```jsonc
// recipes/get_contact_brief.json (illustrative)
{
  "name": "get_contact_brief",
  "description": "A person plus their recent notes, tasks, and open opportunities.",
  "input": { "personId": "string" },
  "steps": [
    { "get":    { "object": "people", "id": "$personId" }, "as": "person" },
    { "expand": { "from": "$person", "relations": ["notes", "tasks", "opportunities"] }, "as": "related" }
  ],
  "output": { "person": "$person", "related": "$related" }
}
```

The recipe runner resolves relations through the `expand` primitive, so whichever of `notes/tasks/opportunities` exist are included and missing ones are skipped — the composite degrades gracefully across schema changes instead of breaking. A renamed relation is a recipe edit (or self-heals via `expand`), never a code release.

**Manifest location.** Bundled with each segment package (versioned, tested), but plain declarative JSON so they are editable without a rebuild — consistent with v1's "knowledge is editable, not released" thesis. The companion Skill documents the recipes and filter DSL, as today.

**Enforcement order** on every tool call: resolve active connection → check profile scope / read-only → run primitive or recipe → audit-log `{ connection, env, role, tool, outcome }`. Profile gating is suite-side curation; Twenty's role enforcement is the hard boundary beneath it.

## CRM segment (concretely)

`twenty-crm-mcp` ships with **no new handler code** — a profile, a few recipes, and server wiring:

- *Aliased primitives* (profile): `find_contacts`, `find_companies`, `find_opportunities`, `create_followup_task`, `append_note`, plus generic `get_record` / `update_record` / `search` scoped to the CRM object set.
- *Recipes* (declarative): `get_contact_brief`, `get_account_snapshot` (record + graceful `expand`), `update_opportunity_stage` (a configured field-update, not bespoke code).
- *Connection tools*: `switch_connection` (known labels only), `refresh_schema`.
- *Resource*: the `twenty://schema` read-only MCP resource carries over from v1.
- `get_recent_activity_summary` is **deferred** — it is aggregation and belongs to the Analytics cycle.

## Testing

- **Unit (offline, v1 pattern):** inject `fetchImpl` into clients and a loader into the schema cache; assert on `JSON.parse`'d tool output. New coverage: profile enforcement (out-of-scope object refused; read-only blocks writes; alias binding works), recipe runner (graceful degradation when a relation is absent), and the auth layer (token refresh, provider selection, store round-trip) against a fake token endpoint.
- **Integration (env-gated, against the live 2.17.2 instance):** the source of truth for wire formats — verifies `search`, `upsert_records`, and one real OAuth loopback round-trip. This is where the two `PROVISIONAL` primitives graduate to verified.

## Verification tasks (trust-but-verify, carried through the build)

1. `search` REST path shape — confirm/adjust (was `PROVISIONAL` in v1).
2. `upsert_records` mutation name/casing + `upsert: true` arg — confirm/adjust (was `PROVISIONAL` in v1).
3. Twenty OAuth client model on 2.17.2 — PKCE *public* client vs required `client_secret`; the loopback flow adapts to whichever.

## v1 migration

The current single-package `main` becomes `packages/twenty-core` (transport, schema, primitives) + `packages/twenty-crm-mcp` (wiring + profile + recipes). Behavior-preserving restructure; existing tests move with their code.

## Out of scope (Spec 1)

Each is its own later cycle: the Ops / Analytics / Data segments, the `aggregate` primitive, and any hosted multi-user / HTTP-transport mode. The seams built now (profile loader, recipe runner, `expand`, connection registry, audit) let those drop in without redesign.

## Risks & mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| OAuth app registration per instance is heavier than pasting an API key. | Setup friction may deter adoption. | Keep `apikey` as the no-friction fallback; document a one-time per-instance OAuth setup. |
| Twenty 2.17.2 OAuth may require a confidential `client_secret` (not a pure public PKCE client). | Loopback flow design must adapt. | Verification task 3; the credential provider supports both confidential and public modes. |
| Declarative profile/recipe format becomes an under-specified DSL. | Scope creep into a generic query-builder. | Keep the manifest schema minimal and explicit; only add fields a real recipe needs. |
| Building the foundation atop two unverified v1 primitives. | Core ships unverified behavior. | Verification tasks 1–2 are gated in the integration suite before release. |
| Monorepo coordination overhead with only one segment. | Versioning friction early. | Accepted cost (decision 4); the public core API is exercised by CRM now and by later segments as they arrive. |
