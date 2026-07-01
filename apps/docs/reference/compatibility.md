# Compatibility & caveats

## Validated against Twenty v2.17.2

The following were confirmed against a running self-hosted instance:

- **OAuth sign-in** — public/PKCE client with endpoint discovery.
- **Object-scoped curation** — out-of-scope objects refused.
- **Depth composites** — `get_contact_brief` / `get_account_snapshot` return inlined relations.

Other Twenty versions are likely to work given the API's stability and the discovery-driven OAuth, but have not been tested. If you hit a mismatch, please open an issue with the response Twenty actually returned.

## Two provisional wire formats

Two tool wire formats are inferred from documentation and **not yet exercised against a live instance**, so they may need adjustment:

- **`search`** (`GET /rest/search`) — the exact query parameter names and response envelope are unverified.
- **`upsert_records`** (GraphQL) — the generated mutation name casing (derived from the object's plural name) and the `upsert: true` argument shape are unverified.

Both call sites are marked `// PROVISIONAL` in `packages/twenty-core/src/tools/readTools.ts` and `packages/twenty-core/src/tools/upsertTool.ts`.
