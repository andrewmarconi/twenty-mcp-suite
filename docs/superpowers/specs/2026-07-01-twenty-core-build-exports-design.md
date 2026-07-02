# Design: `twenty-core` real build + dist exports (publishable library)

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan
**Issue:** #7 — twenty-core: real tsc build + dist exports (currently bundle-only)
**Unblocks:** #1 (Ops), #2 (Analytics), #4 (Data)

## Problem

`twenty-core`'s `package.json` declares `exports: { ".": "./src/index.ts" }` — it points at
raw TypeScript, and its `build` script is `tsc -p tsconfig.json --noEmit` (type-check only,
emits nothing). No `dist/` is produced. This works today **only** because the sole consumer,
`twenty-crm-mcp`, bundles `twenty-core` via tsup `noExternal`, reading it straight from
source. A future **non-bundling consumer** — the Ops/Analytics/Data segments, or a plain
`node -e "import('twenty-core')"` — hits `ERR_MODULE_NOT_FOUND` because the `.js` files the
exports imply do not exist on disk.

`twenty-core` was also marked `private: true`, which forced the "every consumer must bundle"
model. It is meant to be one of the suite's two published-shaped packages. This spec makes
`twenty-core` a real, published library: a `tsup` build emitting `dist/` (JS + type
declarations), a corrected `exports` map, and `private` removed. `twenty-crm-mcp` stops
bundling it and depends on it as a normal package. This unblocks the later segments, which
can then `import` core without any bundling gymnastics.

## Release model (context)

All packages are released from this monorepo in **lockstep at a shared version number**
(`twenty-core` and `twenty-crm-mcp` are both `0.1.0` today and move together). Consequences
this design relies on:

- `twenty-crm-mcp` keeps `"twenty-core": "workspace:*"` in `dependencies`. On `pnpm publish`,
  `workspace:*` is rewritten to the **exact** current version, so `twenty-crm-mcp@X` always
  depends on `twenty-core@X` — a guaranteed matched pair, with no semver-range compatibility
  window to reason about.
- Publishing `twenty-crm-mcp` therefore also publishes a same-versioned `twenty-core`. That
  is intended, not incidental.

Wiring an actual publish pipeline (changesets, `npm publish`, provenance) is **out of scope**
here; this spec only makes the packages build- and dependency-correct for it.

## Changes

### `packages/twenty-core`

- **`tsup.config.ts` (new):**
  ```ts
  import { defineConfig } from "tsup";
  export default defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "node20",
    dts: true,
    clean: true,
  });
  ```
  No shebang banner (it is a library, not an executable). `@modelcontextprotocol/sdk` and
  `zod` are dependencies and stay external (tsup's default) — the built `dist/index.js`
  imports them at runtime; consumers already carry them.
- **`package.json`:**
  - remove `"private": true` (publishable).
  - `"build": "tsup"` (was `tsc -p tsconfig.json --noEmit`).
  - add `"typecheck": "tsc -p tsconfig.json --noEmit"` — preserves the full type-check the
    old `build` script performed (tsup/esbuild transpiles without full type-checking).
  - `"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`.
  - add `"files": ["dist"]`.
  - add a `"description"` and a `"repository"` field (a public package needs them; mirror
    `twenty-crm-mcp`'s `repository`).
  - add `tsup` to `devDependencies` via bare `pnpm add -D tsup --filter twenty-core` (the
    supply-chain age guard picks the version).

### `packages/twenty-crm-mcp`

- **`tsup.config.ts`:** remove `noExternal: ["twenty-core"]`. `twenty-core` becomes an
  external dependency; the built `dist/index.js` and `dist/cli-bin.js` now `import` it at
  runtime rather than inlining it. Everything else (entry points, banner, format) is
  unchanged.
- **`package.json`:** unchanged — `"twenty-core": "workspace:*"` already sits in
  `dependencies` (previously redundant under bundling; now load-bearing).
- **`vitest.config.ts` (new):** alias `twenty-core` to `../twenty-core/src/index.ts` so the
  test suite continues to resolve core's TypeScript **source** — tests need no prior build and
  the dev loop stays fast.
  ```ts
  import { defineConfig } from "vitest/config";
  import { fileURLToPath } from "node:url";
  export default defineConfig({
    resolve: {
      alias: {
        "twenty-core": fileURLToPath(new URL("../twenty-core/src/index.ts", import.meta.url)),
      },
    },
  });
  ```

### Build ordering

`pnpm -r build` runs recursive scripts in **topological** order by workspace dependency, so
`twenty-core` builds before `twenty-crm-mcp`. `twenty-crm-mcp`'s tsup build resolves the now-
external `twenty-core` through its `exports` → `dist/index.js`, which exists by then. The
plan verifies this with a clean-slate `pnpm -r build`.

### Documentation

- `apps/docs/guide/local-development.md` currently states tsup **bundles** `twenty-core` via
  `noExternal` while `sdk`/`zod` stay external. That is now false. Update it: `twenty-core` is
  an external dependency alongside `@modelcontextprotocol/sdk`/`zod`, so a dev run needs
  `twenty-core` built (`dist/`) and resolvable via the workspace `node_modules` symlink — which
  `pnpm build` (topological) provides. The "launch by absolute path inside the repo" guidance
  still holds and matters more now (all three externals resolve from the repo's
  `node_modules`).
- Grep `AGENTS.md` and the rest of `apps/docs` for any other `noExternal`/"bundled" claim
  about `twenty-core` and correct it.

### Housekeeping

- Ensure `dist/` is gitignored for `twenty-core` (a `dist/` is already produced by
  `twenty-crm-mcp`, so the ignore likely already covers `packages/*/dist`; verify and add if
  missing).

## Non-goals (out of scope)

- The Ops/Analytics/Data segments themselves (this only unblocks them).
- A publish pipeline (changesets / `npm publish` / release automation).
- Full publish metadata polish beyond what a public package minimally needs
  (`description`, `repository`).
- Any change to `twenty-core`'s public API, the resilience model, or the CRM segment's
  runtime behavior.

## Testing / acceptance

1. `pnpm --filter twenty-core build` produces `packages/twenty-core/dist/index.js` **and**
   `dist/index.d.ts`.
2. **Non-bundling import proof:** from the repo root,
   `node --input-type=module -e "import('twenty-core').then(m => console.log(Object.keys(m).length))"`
   prints the export count and exits 0 — no `ERR_MODULE_NOT_FOUND`. (This is the exact failure
   #7 exists to prevent.)
3. **Linkage actually changed:** `twenty-crm-mcp/dist/index.js` contains an external
   `from "twenty-core"` import (core is no longer inlined), and
   `node packages/twenty-crm-mcp/dist/index.js` loads without a module-resolution crash (the
   server starts even with no reachable Twenty, per the lazy-schema design).
4. `pnpm -r build` succeeds from a clean tree (`rm -rf packages/*/dist` first) — confirms
   topological ordering.
5. `pnpm -r test` is green — `twenty-crm-mcp` tests resolve `twenty-core` via the vitest alias
   to source; `twenty-core`'s own tests (relative imports) are unaffected.
6. `pnpm --filter twenty-core typecheck` passes (the preserved full type-check).
