# Docs Site (VitePress on GitHub Pages) — Design

**Date:** 2026-07-01
**Status:** Approved (design); pending spec review before planning
**Scope:** A user-facing documentation site for the `twenty-mcp-suite`, hosted on GitHub Pages.

## Summary

Stand up a VitePress documentation site in a new `apps/docs/` workspace package, published to GitHub Pages at `https://andrewmarconi.github.io/twenty-mcp-suite/` via a GitHub Actions workflow. Content covers product usage (install, auth, tools) plus a curated architecture section; the internal SDD specs/plans are **not** published. The site is isolated from the publishable packages so its dev-only toolchain never affects `twenty-core` / `twenty-crm-mcp`.

## Locked decisions

1. **Generator: VitePress** — matches the existing Vite/Vitest tooling; markdown-first, fast, minimal config, built-in local search, small dependency footprint.
2. **URL: project pages** — `andrewmarconi.github.io/twenty-mcp-suite/`; VitePress `base: "/twenty-mcp-suite/"`. A custom domain can be added later without rework.
3. **Deploy: GitHub Actions → Pages** — the standard VitePress+Pages workflow (build → upload artifact → `actions/deploy-pages`).
4. **Location: `apps/docs/` workspace package** — adds `apps/*` to `pnpm-workspace.yaml`; isolated from publishable packages.
5. **Content: product docs + curated architecture** — no raw SDD specs/plans on the site.

## Structure

```
apps/docs/
  package.json            # vitepress dev dep; scripts: dev, build, preview
  .vitepress/
    config.ts             # base "/twenty-mcp-suite/", title, nav, sidebar, local search
  index.md                # landing page (hero + quick links)
  guide/
    introduction.md
    installation.md        # quickstart, npx, Claude config
    authentication.md      # API key + OAuth (discovery/PKCE, encrypted token store)
    connections.md         # connection registry, multi-instance, twenty-mcp CLI
  tools/
    reference.md           # the curated CRM tool set
    scoping.md             # object scope, out-of-scope refusal
    composites.md          # get_contact_brief / get_account_snapshot (depth)
    auditing.md            # stderr audit lines
  architecture/
    overview.md            # suite: twenty-core + segments
    resilience.md          # metadata-driven, refresh_schema recovery
    auth-model.md          # discovery/PKCE, token store, connection registry
    roadmap.md             # ops / analytics segments (deferred)
  reference/
    compatibility.md       # validated 2.17.2; search/upsert PROVISIONAL caveats
    skill.md               # companion Claude Skill
```

- Root `package.json` gains `docs:dev` / `docs:build` scripts filtered to `apps/docs`. The existing `pnpm -r build` / `pnpm -r test` continue to serve only the publishable packages (the docs build is invoked explicitly by the workflow and the root `docs:*` scripts, not required for package publish).
- `pnpm-workspace.yaml` gains `apps/*` under `packages:`; the existing supply-chain age guard applies to the new VitePress dependency.

## Information architecture (sidebar)

- **Guide:** Introduction · Installation & Quickstart · Authentication · Connections & multi-instance
- **Tools:** Reference · Object scoping · Composite reads · Auditing
- **Architecture:** Suite overview · Resilience · Auth model · Roadmap
- **Reference:** Compatibility & caveats · Companion Skill

Top nav mirrors the four sections; local (offline) search enabled via VitePress's built-in MiniSearch provider.

## Content sourcing

Pages adapt the already-accurate `packages/twenty-crm-mcp/README.md` and the foundation design spec (`docs/superpowers/specs/2026-06-30-twenty-suite-foundation-design.md`, architecture section) into fuller docs. The site becomes the *fuller* home; the package README stays the concise npm-facing pointer. Nothing is invented — content reflects what is built and live-verified against Twenty 2.17.2 (OAuth sign-in, object-scoped curation, depth composites), and preserves the accurate `search` / `upsert_records` PROVISIONAL caveats.

## Deploy

`.github/workflows/deploy-docs.yml`:
- Triggers: push to `main` touching `apps/docs/**` (and `workflow_dispatch` for manual runs).
- Steps: checkout → setup pnpm + Node 20 → `pnpm install` (scoped) → `pnpm --filter docs build` → upload `apps/docs/.vitepress/dist` as a Pages artifact → `actions/deploy-pages`.
- Permissions: `pages: write`, `id-token: write`; concurrency group so overlapping runs don't clash.

**Manual step (operator):** enable Pages in repo **Settings → Pages → Source = GitHub Actions**. This cannot be done from code or `gh` reliably and must be flipped once. The site goes live on the first successful workflow run.

## Out of scope

- Raw SDD specs/plans/PRD on the public site.
- Custom domain / DNS (project-pages URL for now; addable later).
- Doc versioning, blog, i18n, analytics.
- Auto-generating the tools reference from code (hand-authored from the profile for now; revisit if it drifts).

## Risks & mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `base` path misconfigured → broken asset URLs on Pages | Site loads without CSS/links | Set `base: "/twenty-mcp-suite/"` and verify the first deploy; VitePress handles the rest. |
| Docs drift from the code (tool names, caveats) | Misleading docs | Source from the current README/spec; keep the tools reference hand-curated and note it as a maintenance point. |
| VitePress dev deps leak into published packages | Bloated installs | Isolated in `apps/docs`; publishable packages never depend on it. |
| Pages source not set to GitHub Actions | Workflow deploys nothing | Documented manual one-time repo setting; called out in the plan and the workflow README. |
