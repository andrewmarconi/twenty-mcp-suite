# twenty-core real build + dist exports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `twenty-core` a real, publishable ESM library — a tsup build emitting `dist/` (JS + types) with a corrected `exports` map — and switch `twenty-crm-mcp` from bundling it to depending on it, so future segments can `import` core without bundling.

**Architecture:** `twenty-core` gains a `tsup.config.ts` (esm + dts), loses `private`, and its `exports` point at `dist`. `twenty-crm-mcp` drops `noExternal: ["twenty-core"]` (core becomes an external runtime dependency, `workspace:*`) and adds a vitest alias so its tests still resolve core's TypeScript source. A doc paragraph that described the old bundling is corrected.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), pnpm workspaces, tsup, vitest.

## Global Constraints

- Node **>= 22**; package manager is **pnpm** (install with bare `pnpm add`, never `@latest` — the `minimumReleaseAge` guard picks the version).
- **ESM only**, `.js` import extensions on local imports.
- All packages release in **lockstep at a shared version**; `workspace:*` rewrites to the exact version on publish.
- `twenty-crm-mcp` **must still ship `twenty-core`** — now as a declared dependency, not a bundle.
- `dist/` is already gitignored (`.gitignore` line 2 `dist/`) — no gitignore change needed.
- Tests inject fakes / run offline; the CRM suite resolves `twenty-core` via a vitest alias to source.

---

### Task 1: `twenty-core` — real build, publishable, dist exports

**Files:**
- Create: `packages/twenty-core/tsup.config.ts`
- Modify: `packages/twenty-core/package.json`

**Interfaces:**
- Produces: `twenty-core` resolvable as a built ESM package — `exports["."]` → `{ types: "./dist/index.d.ts", import: "./dist/index.js" }`; scripts `build` (tsup) and `typecheck` (tsc --noEmit). No source API change.

- [ ] **Step 1: Add tsup as a dev dependency**

Run: `pnpm add -D tsup --filter twenty-core`
Expected: `tsup` appears in `packages/twenty-core/package.json` `devDependencies`; lockfile updates.

- [ ] **Step 2: Create the tsup config**

Create `packages/twenty-core/tsup.config.ts`:

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

(No shebang banner — this is a library. `@modelcontextprotocol/sdk` and `zod` are dependencies and stay external by default.)

- [ ] **Step 3: Update `package.json` — build, exports, publishable, metadata**

In `packages/twenty-core/package.json`:
- Remove the `"private": true` line.
- Change the `build` script and add `typecheck`:
  ```json
  "build": "tsup",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  ```
- Replace the `exports` field:
  ```json
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  ```
- Add `"files": ["dist"]`.
- Add `description` and `repository` (mirror `twenty-crm-mcp`'s repository, with this package's directory):
  ```json
  "description": "Reusable, schema-adaptable engine for the Twenty CRM MCP suite: REST/GraphQL clients, schema cache, generic metadata-driven tools, auth, and capability profiles.",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/andrewmarconi/twenty-mcp-suite.git",
    "directory": "packages/twenty-core"
  },
  ```

- [ ] **Step 4: Build and verify dist is emitted**

Run: `pnpm --filter twenty-core build`
Expected: succeeds; `packages/twenty-core/dist/index.js` **and** `packages/twenty-core/dist/index.d.ts` now exist.

Verify: `ls packages/twenty-core/dist/index.js packages/twenty-core/dist/index.d.ts`
Expected: both paths listed (no "No such file").

- [ ] **Step 5: Prove a non-bundling import resolves (the point of #7)**

Run: `node --input-type=module -e "import('twenty-core').then(m => { console.log('exports:', Object.keys(m).length); })"`
Expected: prints `exports: <N>` (N > 0) and exits 0 — **no** `ERR_MODULE_NOT_FOUND` / `Cannot find package`.

- [ ] **Step 6: Typecheck passes**

Run: `pnpm --filter twenty-core typecheck`
Expected: exits 0 (no type errors).

- [ ] **Step 7: Core's own tests still pass**

Run: `pnpm --filter twenty-core test`
Expected: all tests pass (unchanged — core tests use relative imports).

- [ ] **Step 8: Commit**

```bash
git add packages/twenty-core/tsup.config.ts packages/twenty-core/package.json pnpm-lock.yaml
git commit -m "feat(core): real tsup build + dist exports; make publishable (#7)"
```

---

### Task 2: `twenty-crm-mcp` — depend on core, stop bundling

**Files:**
- Modify: `packages/twenty-crm-mcp/tsup.config.ts`
- Create: `packages/twenty-crm-mcp/vitest.config.ts`

**Interfaces:**
- Consumes: `twenty-core`'s new `dist` exports (Task 1).
- Produces: `twenty-crm-mcp`'s build now emits an external `import ... from "twenty-core"` (core no longer inlined); its tests resolve `twenty-core` to source via a vitest alias.

- [ ] **Step 1: Add the vitest alias (keep tests on core's source)**

Create `packages/twenty-crm-mcp/vitest.config.ts`:

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

- [ ] **Step 2: Confirm the alias keeps the CRM suite green (before touching the build)**

Run: `pnpm --filter twenty-crm-mcp test`
Expected: all tests pass — they now resolve `twenty-core` through the alias to `../twenty-core/src/index.ts`.

- [ ] **Step 3: Drop `noExternal` so core becomes an external dependency**

In `packages/twenty-crm-mcp/tsup.config.ts`, remove the `noExternal: ["twenty-core"],` line. The file becomes:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli-bin.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});
```

(`twenty-core` is in `dependencies` as `workspace:*` — tsup externalizes dependencies by default, so it is no longer inlined.)

- [ ] **Step 4: Build and verify core is now external (not inlined)**

Run: `pnpm --filter twenty-core build && pnpm --filter twenty-crm-mcp build`
Expected: both succeed.

Verify core is externalized: `grep -c 'from "twenty-core"' packages/twenty-crm-mcp/dist/index.js`
Expected: `1` or more (the built server now imports `twenty-core` at runtime rather than containing its inlined source).

- [ ] **Step 5: Smoke — the built server resolves core at runtime**

Run: `timeout 3 node packages/twenty-crm-mcp/dist/index.js < /dev/null 2>&1 | head -20; echo "exit=${PIPESTATUS[0]}"`
Expected: **no** `ERR_MODULE_NOT_FOUND` / `Cannot find package 'twenty-core'` in the output. The process either exits 0 (stdin EOF closes the transport) or is killed by the 3s timeout (`exit=124`) — both mean module resolution succeeded and the server loaded.

- [ ] **Step 6: Clean-slate recursive build proves topological order**

Run: `rm -rf packages/*/dist && pnpm -r build`
Expected: succeeds — `twenty-core` builds before `twenty-crm-mcp` (pnpm runs recursive scripts in dependency order).

- [ ] **Step 7: Full suite green**

Run: `pnpm -r test`
Expected: `twenty-core` and `twenty-crm-mcp` suites all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/twenty-crm-mcp/tsup.config.ts packages/twenty-crm-mcp/vitest.config.ts
git commit -m "feat(crm): depend on twenty-core as a package instead of bundling (#7)"
```

---

### Task 3: Docs — correct the bundling description

**Files:**
- Modify: `apps/docs/guide/local-development.md`
- Possibly modify: `AGENTS.md` and other `apps/docs/*` (only if a stale bundling claim is found)

**Interfaces:** none (docs only).

- [ ] **Step 1: Find stale "noExternal" / "bundled" claims about twenty-core**

Run: `grep -rn -i "noexternal\|bundle" AGENTS.md apps/docs/guide/local-development.md apps/docs`
Expected: at least the `local-development.md` paragraph that says tsup bundles `twenty-core` via `noExternal`.

- [ ] **Step 2: Correct `local-development.md`**

In `apps/docs/guide/local-development.md`, the Build section currently states tsup **bundles** `twenty-core` (`noExternal`) while `sdk`/`zod` stay external. Replace that explanation so it reads that `twenty-core` is now an **external dependency** alongside `@modelcontextprotocol/sdk` and `zod` — the built `dist/index.js` imports all three at runtime, resolved from the repo's `node_modules` (the workspace symlink to `twenty-core`, which must be built). Keep the existing "launch by the absolute path inside the repo" guidance — it still holds and matters more now. Concretely, replace the sentence:

> It's executable (`#!/usr/bin/env node` banner). tsup **bundles `twenty-core` into the output** (`noExternal`), but keeps `@modelcontextprotocol/sdk` and `zod` external — so the file still needs the package's `node_modules` at runtime. Always launch it by its **absolute path inside the repo** so Node resolves those externals; don't copy `dist/index.js` elsewhere.

with:

> It's executable (`#!/usr/bin/env node` banner). tsup keeps `twenty-core`, `@modelcontextprotocol/sdk`, and `zod` **external**, so the file imports all three at runtime from the repo's `node_modules` — including the workspace symlink to `twenty-core` (which must be built first; `pnpm build` does this in dependency order). Always launch it by its **absolute path inside the repo** so Node resolves those dependencies; don't copy `dist/index.js` elsewhere.

- [ ] **Step 3: Fix any other stale claim found in Step 1**

If Step 1 surfaced a bundling/`noExternal` claim about `twenty-core` in `AGENTS.md` or another docs page, correct it to match: `twenty-crm-mcp` depends on `twenty-core` as a package (external), it does not bundle it. If Step 1 found nothing beyond `local-development.md`, skip this step.

- [ ] **Step 4: Docs still build**

Run: `pnpm docs:build`
Expected: build completes (no broken links / markdown errors).

- [ ] **Step 5: Commit**

```bash
git add apps/docs/guide/local-development.md AGENTS.md
git commit -m "docs: twenty-crm-mcp depends on twenty-core (no longer bundles it) (#7)"
```

(Only stage `AGENTS.md` if Step 3 modified it.)

---

## Notes for the implementer

- **`workspace:*` stays as-is** in `twenty-crm-mcp`'s `dependencies` — do not change it to a version range. On publish, pnpm rewrites it to the exact shared version.
- **Do not add `noExternal` back**, and do not bundle core. The whole point is that core is now an independently resolvable package.
- **tsup externalizes `dependencies` by default** — removing the `noExternal` line is all that is needed to make `twenty-core` external; `sdk`/`zod` were already external.
- The vitest alias uses an **exact** key `"twenty-core"`, which matches the bare `import ... from "twenty-core"` specifiers in the CRM source and tests.
- Core builds emit only `dist/index.js` + `dist/index.d.ts` (single-entry bundle) — that is expected, not a missing-files error.
