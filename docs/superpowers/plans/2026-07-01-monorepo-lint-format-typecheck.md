# Monorepo lint / format / typecheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one enforced toolchain across the monorepo — Biome for lint + format (JS/TS/JSON), per-package `tsc --noEmit` type-checking with a root aggregator, and a CI workflow that runs the lot on every push/PR.

**Architecture:** Biome at the repo root (single `biome.json` + root scripts) formats and lints all JS/TS/JSON, leaving Markdown/Vue untouched. Type-checking stays per-package (`tsc --noEmit`) with a root `pnpm -r typecheck` aggregator. A new `ci.yml` runs `check` + `typecheck` + `test` + `build`. A one-time reformat commit converts the existing code to Biome's style.

**Tech Stack:** Biome 2.x, TypeScript (`tsc --noEmit`), pnpm workspaces, GitHub Actions.

## Global Constraints

- Node **>= 22**; package manager **pnpm** (install with bare `pnpm add` — the `minimumReleaseAge` guard picks the version; never `@latest`/pinned).
- Biome handles **JS/TS/JSON only** — never Markdown or `.vue` (preserves the docs' unwrapped prose).
- `assist` / import-organizing stays **off** for v1 (avoid a repo-wide import reorder).
- Type-checking covers `twenty-core` + `twenty-crm-mcp` only; `apps/docs` is lint/format-only (no tsconfig).
- `twenty-core` already has a `typecheck` script (from #7); do not duplicate it.
- Where a `recommended` lint rule fires on established, intentional code, **disable that specific rule** with a one-line reason — do not churn working code to satisfy style.
- The reformat must change **no** `.md`/`.vue` file and **no** runtime behavior (tests stay green).

---

### Task 1: Adopt Biome (config + scripts + one-time reformat)

**Files:**
- Create: `biome.json` (repo root)
- Modify: `package.json` (root — devDep + scripts)
- Modify (mechanically, reformat): every tracked `.ts`/`.js`/`.json` Biome touches

**Interfaces:**
- Produces: root scripts `format`, `lint`, `check`, `check:fix`; a committed `biome.json`. After this task, `pnpm check` exits 0 on the whole repo.

- [ ] **Step 1: Install Biome at the workspace root**

Run: `pnpm add -D -w @biomejs/biome`
Expected: `@biomejs/biome` appears in root `package.json` `devDependencies`; lockfile updates. (If `ERR_PNPM_IGNORED_BUILDS` fires for biome's postinstall, add `@biomejs/biome` under `onlyBuiltDependencies` in `pnpm-workspace.yaml` and re-install.)

- [ ] **Step 2: Scaffold and configure `biome.json`**

Run `pnpm biome init` to scaffold a schema-correct `biome.json`, then set it to exactly this (keep the `$schema` version that `init` wrote — it matches the installed Biome; Biome validates its own config, so a wrong key errors immediately):

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/<installed-version>/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "includes": [
      "**/*.ts", "**/*.js", "**/*.mjs", "**/*.cjs", "**/*.json", "**/*.jsonc",
      "!**/dist/**",
      "!**/node_modules/**",
      "!apps/docs/.vitepress/dist/**",
      "!apps/docs/.vitepress/cache/**",
      "!graphify-out/**",
      "!**/*.d.ts"
    ]
  },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": {
    "formatter": { "quoteStyle": "double", "semicolons": "always", "trailingCommas": "all" }
  },
  "json": { "formatter": { "enabled": true } },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "assist": { "enabled": false }
}
```

(`useIgnoreFile: true` already skips `dist/`/`node_modules/` via `.gitignore`; the explicit ignores are belt-and-suspenders for the VitePress cache, which is not gitignored. Only JS/TS/JSON globs are listed, so Markdown/Vue are never processed.)

- [ ] **Step 3: Add root scripts**

In root `package.json` `scripts`, add:

```json
"format": "biome format --write .",
"lint": "biome lint .",
"check": "biome check .",
"check:fix": "biome check --write ."
```

- [ ] **Step 4: Apply the one-time reformat (safe fixes + formatting)**

Run: `pnpm check:fix`
Expected: Biome rewrites JS/TS/JSON to its style and applies **safe** lint fixes across the repo. This is a large mechanical diff — expected.

Verify no Markdown/Vue was touched:
Run: `git status --porcelain | grep -E '\.(md|vue)$' || echo "no md/vue changed"`
Expected: `no md/vue changed`.

- [ ] **Step 5: Drive `pnpm check` to green by disabling rules that fire on intentional code**

Run: `pnpm check`
Expected initially: some `recommended` lint rules report errors on established patterns. This codebase's likely offenders (confirm by reading the actual output — add exactly the ones that fire, no more):
- `suspicious/noExplicitAny` — tests use `{} as any` / `as never` for fakes (e.g. `upsertTool.test.ts`, `server.test.ts`).
- any other rule the output names on existing, intentional code.

For each, add a scoped `off` with a one-line reason under `linter.rules` in `biome.json`, e.g.:

```jsonc
"linter": {
  "enabled": true,
  "rules": {
    "recommended": true,
    "suspicious": {
      // Test fakes intentionally use `as any` / `as never` to inject minimal stubs.
      "noExplicitAny": "off"
    }
  }
}
```

Prefer a rule-level `off` over editing code. Do **not** disable correctness rules that flag a real bug — if one fires, fix the code instead and note it. Re-run `pnpm check` until it exits 0.

Run: `pnpm check`
Expected: exits 0 (no lint or format violations remain).

- [ ] **Step 6: Confirm idempotence, behavior, and build**

Run: `pnpm format` then `git diff --stat`
Expected: no further changes (formatting has converged).

Run: `pnpm -r test`
Expected: green — `twenty-core` 126, `twenty-crm-mcp` 71 (safe fixes + formatting changed no behavior).

Run: `pnpm -r build`
Expected: both packages build.

- [ ] **Step 7: Commit (two commits — config, then reformat)**

Stage config/scripts separately from the mechanical reformat so review is clean:

```bash
git add biome.json package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "build: add Biome for monorepo lint + format"
git add -A
git commit -m "style: apply Biome formatting across the repo"
```

---

### Task 2: Wire type-checking across packages

**Files:**
- Modify: `packages/twenty-crm-mcp/package.json` (add `typecheck` script)
- Modify: `package.json` (root — add `typecheck` aggregator)

**Interfaces:**
- Consumes: `twenty-core`'s existing `typecheck` script.
- Produces: `twenty-crm-mcp` gains `"typecheck": "tsc -p tsconfig.json --noEmit"`; root gains `"typecheck": "pnpm -r typecheck"`.

- [ ] **Step 1: Add the CRM package typecheck script**

In `packages/twenty-crm-mcp/package.json` `scripts`, add:

```json
"typecheck": "tsc -p tsconfig.json --noEmit"
```

(Its `tsconfig.json` extends the base and sets `outDir`; `--noEmit` overrides so nothing is emitted. `typescript` is already available in the workspace.)

- [ ] **Step 2: Add the root aggregator**

In root `package.json` `scripts`, add:

```json
"typecheck": "pnpm -r typecheck"
```

- [ ] **Step 3: Verify per-package and aggregate typecheck pass**

Run: `pnpm --filter twenty-crm-mcp typecheck`
Expected: exits 0.

Run: `pnpm -r typecheck`
Expected: runs in `twenty-core` and `twenty-crm-mcp` (pnpm runs the script only where defined, so `apps/docs` is skipped) and exits 0.

- [ ] **Step 4: Biome is still clean after the edits**

Run: `pnpm check`
Expected: exits 0 (the two `package.json` edits are Biome-formatted).

- [ ] **Step 5: Commit**

```bash
git add packages/twenty-crm-mcp/package.json package.json
git commit -m "build: add typecheck scripts + root pnpm -r typecheck aggregator"
```

---

### Task 3: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the root `check` (Task 1) and `typecheck` (Task 2) scripts, plus existing `-r test`/`-r build`.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [develop, main]
  pull_request:
    branches: [develop, main]

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm -r typecheck
      - run: pnpm -r test
      - run: pnpm -r build
```

- [ ] **Step 2: Validate the workflow YAML**

Run: `python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml')); assert list(d['jobs']['check']['steps'][-4:][i]['run'] for i in range(4)); print('CI YAML OK')"`
Expected: `CI YAML OK` (parses; the four `run` steps are present).

- [ ] **Step 3: Prove the CI steps pass locally (same commands CI runs)**

Run: `pnpm check && pnpm -r typecheck && pnpm -r test && pnpm -r build`
Expected: all four succeed in sequence (exit 0). This mirrors exactly what the CI job runs.

- [ ] **Step 4: Biome clean (the new yaml is not JS/TS/JSON, so unaffected — sanity check)**

Run: `pnpm check`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run biome check + typecheck + test + build on push/PR"
```

---

## Notes for the implementer

- **Biome validates its own config** — if a key in the Step 2 config is wrong for the installed version, `biome check` errors with the exact path; keep the `$schema` version `biome init` wrote and fix the flagged key.
- **Keep the disable-list minimal and documented.** Only add a rule to `off` when `pnpm check` actually reports it on existing intentional code, and add a one-line reason. Never silence a correctness rule that caught a real bug — fix the code.
- **The reformat is mechanical and behavior-preserving** — Biome's `--write` (without `--unsafe`) applies only safe fixes; `pnpm -r test` staying green is the proof. Do not pass `--unsafe`.
- **Two commits in Task 1** keep the reviewable config change separate from the large formatting diff.
- **Do not format Markdown/Vue.** The `files.includes` globs list only JS/TS/JSON; verify Step 4 touched no `.md`/`.vue`.
- **`graphify-out/` is a large generated JSON cache** (tracked in this repo) — it is excluded via `!graphify-out/**`. After `pnpm check:fix`, confirm `git status --porcelain graphify-out/` shows nothing new from Biome; if it does, the exclusion glob is wrong.
- `twenty-core`'s `typecheck` script already exists (from #7) — Task 2 only adds the CRM one and the root aggregator.
