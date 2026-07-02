# Design: monorepo lint / format / typecheck (Biome + shared typecheck + CI)

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan
**Relates to:** #7 (do #7 first; this formats its new files too)

## Problem

The workspace has **no** shared developer tooling: no linter, no formatter, no root-level
type-check, and no CI that runs tests/lint on a push or PR (only SLSA-on-release and
docs-deploy exist). Root `package.json` has no `devDependencies` and only per-package
`build`/`test` scripts. Style is consistent by hand today, but nothing enforces it, and a
type error in one package is caught only if that package happens to run `tsc`.

This adds one shared, enforced toolchain across all packages: **Biome** for linting and
formatting (one fast tool), `tsc --noEmit` type-checking wired per TypeScript package with a
root aggregator, and a CI workflow that runs the lot on every push/PR.

## Decisions (settled)

- **Biome** for lint + format (single tool, near-zero config, Rust-fast). No type-aware lint
  rules — `tsc` owns type correctness separately, so there is no overlap or gap.
- **Coverage: all packages.** Biome lints/formats the whole repo's JS/TS/JSON. Type-checking
  covers the two TS packages (`twenty-core`, `twenty-crm-mcp`); `apps/docs` has no tsconfig
  and is lint/format-only (its `.ts` config file is still Biome-formatted).
- Biome handles **JS/TS/JSON only**. Markdown and `.vue` are left untouched (Biome's markdown
  formatter is not stable, and leaving `.md` alone preserves the docs' unwrapped prose).

## Biome setup

- Add `@biomejs/biome` to the **root** `devDependencies` via bare `pnpm add -D -w
  @biomejs/biome` (the `minimumReleaseAge` guard picks a safe version; latest is 2.5.x).
- Scaffold `biome.json` at the repo root with `pnpm biome init`, then configure it (pin
  `$schema` to the installed version so the config matches the tool):
  - `formatter`: `indentStyle: "space"`, `indentWidth: 2`, `lineWidth: 100` (existing code is
    2-space; 100 keeps the reformat diff small). JS formatter: `quoteStyle: "double"`,
    `semicolons: "always"`, `trailingCommas: "all"` — matches the current style.
  - `linter`: enabled, `rules: { recommended: true }`. Where a recommended rule fires on an
    established, intentional pattern (e.g. deliberate non-null assertions in handlers, `as`
    casts in tests), **disable that specific rule** with a one-line comment explaining why —
    rather than churning working code to satisfy a style rule. The exact disable-list is
    discovered during implementation by running `biome check` and is kept minimal.
  - `assist` / import organizing: **off** for v1 (avoids a repo-wide import-reorder churn;
    can be enabled later as its own change).
  - `vcs`: `{ enabled: true, clientKind: "git", useIgnoreFile: true }` — respects
    `.gitignore` (so `dist/`, `node_modules/` are skipped). Additionally ignore
    `apps/docs/.vitepress/dist` and any `coverage` output.
  - Scope Biome to JS/TS/JSON so it never touches `.md`/`.vue`.

## Scripts

**Root `package.json`:**
- `"format": "biome format --write ."`
- `"lint": "biome lint ."`
- `"check": "biome check ."` — lint + format-check, no writes; the CI gate.
- `"check:fix": "biome check --write ."` — applies safe fixes + formatting.
- `"typecheck": "pnpm -r typecheck"` — runs each package's `typecheck` (pnpm runs the script
  only in packages that define it, so docs is naturally skipped).

**`packages/twenty-crm-mcp/package.json`:** add `"typecheck": "tsc -p tsconfig.json --noEmit"`
(its `tsconfig.json` already extends the base; `--noEmit` overrides its `outDir`).

**`packages/twenty-core/package.json`:** the `"typecheck": "tsc -p tsconfig.json --noEmit"`
script is added by #7. If #7 has not landed yet, add it here instead (idempotent — whichever
lands first owns it; the other references it).

## One-time reformat

Applying Biome to an existing codebase reformats every JS/TS/JSON file once. The plan does
this as a **dedicated commit** (`pnpm check:fix`) separate from the config/scripts commit, so
the config change is reviewable without the large mechanical diff drowning it.

## CI workflow

`.github/workflows/ci.yml` (new), on `push` and `pull_request` to `develop` and `main`:

- checkout → `pnpm/action-setup@v6` → `actions/setup-node@v6` (Node 22, `cache: pnpm`) →
  `pnpm install --frozen-lockfile`.
- Steps, each failing the job on error: `pnpm check` (Biome), `pnpm -r typecheck`,
  `pnpm -r test`, `pnpm -r build`.
- `permissions: { contents: read }` (least privilege).

This is the first real CI gate for the repo. It is marked here so it can be trimmed at spec
review if a lighter gate is preferred, but it is the point that makes "common across all
packages" actually enforced rather than advisory.

## Interaction with #7

Do **#7 first** (it is approved and small). This tooling change is applied on top:
- The one-time reformat will also format #7's new files (`twenty-core/tsup.config.ts`,
  `twenty-crm-mcp/vitest.config.ts`) — sequential, no conflict.
- #7 adds `twenty-core`'s `typecheck` script; this spec adds `twenty-crm-mcp`'s and the root
  `pnpm -r typecheck` aggregator, plus the CI job that runs them.

## Non-goals (out of scope)

- Custom lint-rule authoring or heavy rule tuning beyond `recommended` (+ the minimal
  documented disable-list).
- Markdown / `.vue` formatting.
- Pre-commit hooks (husky / lint-staged) — a possible later convenience, not needed for
  enforcement (CI covers it).
- Editorconfig (Biome config is the single source of truth).

## Testing / acceptance

1. After the config + one-time reformat, `pnpm check` exits **0** on a clean tree (no lint or
   format violations remain).
2. `pnpm -r typecheck` passes for `twenty-core` and `twenty-crm-mcp`.
3. `pnpm -r test` remains green (formatting/lint fixes changed no behavior) and
   `pnpm -r build` still succeeds.
4. Re-running `pnpm format` produces **no** further diff (formatting is idempotent /
   converged).
5. `.github/workflows/ci.yml` parses as valid YAML and its steps mirror the four root checks.
6. Biome does not modify any `.md` or `.vue` file (verify the reformat commit touches only
   JS/TS/JSON).
