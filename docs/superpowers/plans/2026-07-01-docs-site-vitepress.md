# Docs Site (VitePress + GitHub Pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a VitePress documentation site in `apps/docs/`, published to GitHub Pages at `https://andrewmarconi.github.io/twenty-mcp-suite/`, covering product usage plus a curated architecture section.

**Architecture:** A new `apps/docs/` pnpm workspace package holds the VitePress site (isolated from the publishable packages). A GitHub Actions workflow builds it and deploys to Pages. Content is authored from the current package README and the foundation design spec; nav and sidebar grow per task so each task's build stays dead-link-clean.

**Tech Stack:** VitePress (Vue/Vite static site generator), pnpm workspaces, GitHub Actions → GitHub Pages.

## Global Constraints

- Node `>=20`; pnpm.
- **Install VitePress with a bare `pnpm add` under the supply-chain age guard** — do NOT use `@latest` or `@next`. `pnpm --filter docs add -D vitepress` picks the safe stable (1.x) version; do not hand-pin.
- `apps/docs` is a **private** workspace package (`"private": true`), never published; the publishable packages (`twenty-core`, `twenty-crm-mcp`) must not depend on it.
- **VitePress `base` = `/twenty-mcp-suite/`** (leading + trailing slash) — required for project-pages hosting.
- Content is **accurate to what is built and live-verified** (OAuth sign-in, object-scoped curation, depth composites against Twenty 2.17.2); the `search` and `upsert_records` wire formats remain **PROVISIONAL** and must be described as such. Do not invent features.
- Each content task ends with a **successful `pnpm --filter docs build`** (VitePress fails the build on dead links — that is the test).
- Repo/owner: `andrewmarconi/twenty-mcp-suite`.

## File Structure

```
pnpm-workspace.yaml                      # add "apps/*"
package.json (root)                      # add docs:dev/docs:build scripts + packageManager
apps/docs/
  package.json                           # name "docs", private, vitepress dev dep, scripts
  README.md                              # local dev + the manual Pages step
  .vitepress/config.ts                   # base, title, nav, sidebar (grows per task), local search
  index.md                               # landing (home layout)
  guide/{introduction,installation,authentication,connections}.md
  tools/{reference,scoping,composites,auditing}.md
  architecture/{overview,resilience,auth-model,roadmap}.md
  reference/{compatibility,skill}.md
.github/workflows/deploy-docs.yml        # build + deploy to Pages
```

---

### Task 1: Scaffold `apps/docs` VitePress package + Guide section

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json` (root)
- Create: `apps/docs/package.json`
- Create: `apps/docs/.vitepress/config.ts`
- Create: `apps/docs/index.md`
- Create: `apps/docs/guide/introduction.md`, `installation.md`, `authentication.md`, `connections.md`

**Interfaces:**
- Produces: a buildable VitePress site with the landing page + Guide section. The package is named `docs` (so `pnpm --filter docs …` works); `config.ts` exports `defineConfig({...})` with `base: "/twenty-mcp-suite/"` and a `themeConfig.sidebar` keyed by section path (Guide only in this task; later tasks add keys).

- [ ] **Step 1: Add `apps/*` to the workspace**

Edit `pnpm-workspace.yaml` — add `apps/*` to `packages` (keep the existing age guard + build approvals):

```yaml
packages:
  - "packages/*"
  - "apps/*"
allowBuilds:
  esbuild: true
minimumReleaseAge: 1440
onlyBuiltDependencies:
  - esbuild
```

- [ ] **Step 2: Create the docs package manifest**

Create `apps/docs/package.json`:

```json
{
  "name": "docs",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vitepress dev",
    "build": "vitepress build",
    "preview": "vitepress preview"
  }
}
```

- [ ] **Step 3: Install VitePress into the docs package**

Run: `pnpm install` (registers the new workspace package), then:
Run: `pnpm --filter docs add -D vitepress`
Expected: `vitepress` (1.x) added to `apps/docs/package.json` devDependencies; lockfile updated. If pnpm reports `ERR_PNPM_IGNORED_BUILDS` for a VitePress dependency, add that dependency name under `onlyBuiltDependencies` (and `allowBuilds: <dep>: true`) in `pnpm-workspace.yaml`, then re-run.

- [ ] **Step 4: Write the VitePress config**

Create `apps/docs/.vitepress/config.ts`:

```ts
import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Twenty MCP Suite",
  description: "Version-resilient MCP server suite for self-hosted Twenty CRM.",
  base: "/twenty-mcp-suite/",
  cleanUrls: true,
  themeConfig: {
    search: { provider: "local" },
    nav: [
      { text: "Guide", link: "/guide/introduction" },
      { text: "GitHub", link: "https://github.com/andrewmarconi/twenty-mcp-suite" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Introduction", link: "/guide/introduction" },
            { text: "Installation & Quickstart", link: "/guide/installation" },
            { text: "Authentication", link: "/guide/authentication" },
            { text: "Connections & multi-instance", link: "/guide/connections" },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/andrewmarconi/twenty-mcp-suite" },
    ],
  },
});
```

- [ ] **Step 5: Write the landing page**

Create `apps/docs/index.md`:

```md
---
layout: home
hero:
  name: Twenty MCP Suite
  text: Self-hosted Twenty CRM, AI-operable
  tagline: A version-resilient MCP server that acts as you, scoped to your Twenty role.
  actions:
    - theme: brand
      text: Get started
      link: /guide/installation
    - theme: alt
      text: Introduction
      link: /guide/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/andrewmarconi/twenty-mcp-suite
features:
  - title: Version-resilient
    details: Metadata-driven — reads your live Twenty schema, so custom objects work out of the box and a Twenty upgrade never needs a code release.
  - title: Sign in as yourself
    details: Browser OAuth (PKCE, endpoint discovery) so the assistant inherits your Twenty role. API-key mode too, when you want it simple.
  - title: Curated & audited
    details: A compact, role-scoped CRM toolset with composite reads and structured audit logging — not a raw endpoint dump.
---
```

- [ ] **Step 6: Write the Guide pages**

Author these four pages as accurate prose, adapting from `packages/twenty-crm-mcp/README.md` (which is current). Each must include the facts listed; keep code samples copy-pasteable.

Create `apps/docs/guide/introduction.md` — what the server is (version-resilient, metadata-driven MCP server for self-hosted Twenty), that it is the CRM segment of the `twenty-mcp-suite` monorepo (engine = `twenty-core`), the curated/role-scoped philosophy (tools are mechanism, the companion Skill is knowledge), and the two auth modes at a glance. Link onward to Installation.

Create `apps/docs/guide/installation.md` — the `npx twenty-crm-mcp` quickstart with `TWENTY_BASE_URL` + `TWENTY_API_KEY`, the env-var table (verbatim from the README), and the Claude Code / Claude Desktop `mcpServers` JSON block (using `npx -y twenty-crm-mcp`). Node >= 20.

Create `apps/docs/guide/authentication.md` — the two modes in full: (1) **API key** (env vars, acts with the key's permissions); (2) **OAuth sign-in** — acts as the signed-in user inheriting their Twenty role, uses Authorization-Code + PKCE with RFC 7591 dynamic registration and RFC 8414 discovery (adapts to public or confidential client), refresh tokens stored AES-256-GCM encrypted under `~/.config/twenty-mcp/` with the key file mode `0600`. Include the `twenty-mcp login <label>` flow.

Create `apps/docs/guide/connections.md` — the connection registry (`~/.config/twenty-mcp/connections.json`) JSON shape (from the README), selecting the active connection with `TWENTY_CONNECTION`, running several instances, and the `twenty-mcp` CLI (`login` / `connections` / `logout`). Note that per-process one connection is active (in-session switching is not yet available).

- [ ] **Step 7: Add root scripts + packageManager**

In the root `package.json`, add the docs scripts and a `packageManager` field (run `pnpm --version` and use that exact version). Merge into the existing `scripts`:

```json
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "dev": "pnpm --filter twenty-crm-mcp dev",
    "docs:dev": "pnpm --filter docs dev",
    "docs:build": "pnpm --filter docs build"
  },
  "packageManager": "pnpm@<output of `pnpm --version`>"
```

Note: `pnpm -r build`/`test` do not target `docs` for publish purposes, but `docs` does define a `build` script, so `pnpm -r build` will also build the site — that is harmless. The publishable packages remain unaffected.

- [ ] **Step 8: Build to verify (this is the test)**

Run: `pnpm --filter docs build`
Expected: VitePress builds with **no dead-link errors**; `apps/docs/.vitepress/dist/index.html` exists.

Run: `ls apps/docs/.vitepress/dist/index.html`
Expected: the file is listed.

- [ ] **Step 9: Ignore the build output + commit**

Add `apps/docs/.vitepress/dist/` and `apps/docs/.vitepress/cache/` to `.gitignore` (append):

```gitignore
apps/docs/.vitepress/dist/
apps/docs/.vitepress/cache/
```

```bash
git add -A
git commit -m "feat(docs): scaffold VitePress site + Guide section"
```

---

### Task 2: Tools section

**Files:**
- Create: `apps/docs/tools/reference.md`, `scoping.md`, `composites.md`, `auditing.md`
- Modify: `apps/docs/.vitepress/config.ts` (add Tools to nav + sidebar)

**Interfaces:**
- Consumes: the config/sidebar shape from Task 1.
- Produces: the Tools section, dead-link-clean.

- [ ] **Step 1: Add the Tools nav + sidebar**

In `apps/docs/.vitepress/config.ts`, add a nav item after Guide:

```ts
      { text: "Tools", link: "/tools/reference" },
```

and add a sidebar key:

```ts
      "/tools/": [
        {
          text: "Tools",
          items: [
            { text: "Reference", link: "/tools/reference" },
            { text: "Object scoping", link: "/tools/scoping" },
            { text: "Composite reads", link: "/tools/composites" },
            { text: "Auditing", link: "/tools/auditing" },
          ],
        },
      ],
```

- [ ] **Step 2: Write the Tools pages**

Author from `packages/twenty-crm-mcp/README.md` (Tools + Auditing sections) and `packages/twenty-crm-mcp/src/profile.ts` (the exact exposed tools).

Create `apps/docs/tools/reference.md` — the curated CRM tool set grouped as **Discovery & schema** (`list_object_types`, `describe_object`, `refresh_schema`), **Reading** (`find_contacts`, `find_companies`, `find_opportunities`, `query_records`, `get_record`, `get_contact_brief`, `get_account_snapshot`, `search`), **Writing** (`create_tasks`, `create_records`, `update_records`, `delete_records`, `upsert_records`). One row/description each, matching the README tables. Note the `twenty://schema` resource. Include the filter syntax (`field[operator]:value`).

Create `apps/docs/tools/scoping.md` — the CRM segment is scoped to `people`, `companies`, `opportunities`, `tasks`, `notes`; `list_object_types` shows only those; a call addressing an out-of-scope object is refused (`Object "X" is not available in the "crm" profile.`). State the boundary explicitly: scope applies to the *addressed* object, not related ids inside record bodies (Twenty validates those); `search` is unscoped by design.

Create `apps/docs/tools/composites.md` — `get_contact_brief` (a person + related company/notes/tasks/opportunities/activity, depth 1) and `get_account_snapshot` (a company + related people/opportunities/notes/tasks, depth 1). Explain they are depth-bound reads (Twenty's native relation `depth`), take just an `id`, and were verified live against 2.17.2. Show a short example call/response shape.

Create `apps/docs/tools/auditing.md` — every tool call emits one structured JSON line to **stderr** (stdout is reserved for MCP): `{"audit":{"tool":"...","connection":"...","env":"...","outcome":"ok","ms":...}}`. It records metadata only — never args, results, tokens, or record contents; on error it carries the error message.

- [ ] **Step 3: Build + commit**

Run: `pnpm --filter docs build`
Expected: builds clean, no dead links.

```bash
git add -A
git commit -m "docs(site): Tools section (reference, scoping, composites, auditing)"
```

---

### Task 3: Architecture + Reference sections

**Files:**
- Create: `apps/docs/architecture/overview.md`, `resilience.md`, `auth-model.md`, `roadmap.md`
- Create: `apps/docs/reference/compatibility.md`, `skill.md`
- Modify: `apps/docs/.vitepress/config.ts` (add Architecture + Reference to nav + sidebar)

**Interfaces:**
- Consumes: config from Tasks 1–2.
- Produces: the final two sections, dead-link-clean.

- [ ] **Step 1: Add the Architecture + Reference nav + sidebar**

In `apps/docs/.vitepress/config.ts`, add two nav items:

```ts
      { text: "Architecture", link: "/architecture/overview" },
      { text: "Reference", link: "/reference/compatibility" },
```

and two sidebar keys:

```ts
      "/architecture/": [
        {
          text: "Architecture",
          items: [
            { text: "Suite overview", link: "/architecture/overview" },
            { text: "Resilience", link: "/architecture/resilience" },
            { text: "Auth model", link: "/architecture/auth-model" },
            { text: "Roadmap", link: "/architecture/roadmap" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "Compatibility & caveats", link: "/reference/compatibility" },
            { text: "Companion Skill", link: "/reference/skill" },
          ],
        },
      ],
```

- [ ] **Step 2: Write the Architecture pages**

Author from `docs/superpowers/specs/2026-06-30-twenty-suite-foundation-design.md` (architecture sections) — describe what is built, at a level useful to an evaluator, without exposing raw SDD process.

Create `apps/docs/architecture/overview.md` — the suite: a shared `twenty-core` engine (transport, schema cache, generic primitives, auth) with thin segments composed over it; `twenty-crm-mcp` is the CRM segment. The "tools are mechanism, the Skill is knowledge" split. A capability profile scopes and names the segment's surface as configuration over generic primitives (so resilience survives).

Create `apps/docs/architecture/resilience.md` — metadata-driven: object/field names come from the live schema (Metadata API), resolved at runtime; custom objects work automatically; schema drift is handled by an explicit `refresh_schema` recovery tool, not auto-healed. Nothing schema-specific is compiled in.

Create `apps/docs/architecture/auth-model.md` — the `Connection`/`getBearer()` seam; pluggable credential providers (API key + OAuth); OAuth via discovery (RFC 8414) + dynamic registration (RFC 7591) + PKCE, adapting to public/confidential clients; encrypted local token store; the connection registry for multiple instances. Access level flows from the signed-in user's Twenty role.

Create `apps/docs/architecture/roadmap.md` — the CRM segment is complete; planned segments are **Ops** (health, export, schema-diff, guarded admin) and **Analytics** (pipeline/aging/activity rollups + an aggregation primitive), each a separate opt-in capability pack. Frame as intent, not commitments.

- [ ] **Step 3: Write the Reference pages**

Create `apps/docs/reference/compatibility.md` — validated live against **Twenty v2.17.2** (OAuth sign-in, object-scoped curation, depth composites confirmed against a running instance); other versions likely work given API stability + discovery-driven OAuth, untested. The **two provisional wire formats**: `search` (`GET /rest/search` params + envelope unverified) and `upsert_records` (GraphQL mutation name casing + `upsert: true` arg unverified), marked `// PROVISIONAL` in `packages/twenty-core/src/tools/readTools.ts` and `upsertTool.ts`; ask users to open an issue with the real response on a mismatch.

Create `apps/docs/reference/skill.md` — the companion Claude Skill ships with the server (filter syntax, describe-before-write discipline, batch/upsert guidance, `refresh_schema` reflex, auth-mode note). Include the install command (`cp -r node_modules/twenty-crm-mcp/skill/twenty-crm .claude/skills/twenty-crm`).

- [ ] **Step 4: Build + commit**

Run: `pnpm --filter docs build`
Expected: builds clean, no dead links.

```bash
git add -A
git commit -m "docs(site): Architecture + Reference sections"
```

---

### Task 4: GitHub Actions deploy workflow + docs README

**Files:**
- Create: `.github/workflows/deploy-docs.yml`
- Create: `apps/docs/README.md`

**Interfaces:**
- Consumes: the buildable site (`pnpm --filter docs build` → `apps/docs/.vitepress/dist`) and the root `packageManager` field (Task 1, Step 7) that `pnpm/action-setup` reads.
- Produces: an automated Pages deploy on push to `main`.

- [ ] **Step 1: Write the deploy workflow**

Create `.github/workflows/deploy-docs.yml`:

```yaml
name: Deploy docs to Pages

on:
  push:
    branches: [main]
    paths:
      - "apps/docs/**"
      - ".github/workflows/deploy-docs.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 20
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Build docs
        run: pnpm --filter docs build
      - name: Setup Pages
        uses: actions/configure-pages@v4
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: apps/docs/.vitepress/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Write the docs package README (local dev + the manual Pages step)**

Create `apps/docs/README.md`:

```md
# Docs site (VitePress)

The `twenty-mcp-suite` documentation site, deployed to GitHub Pages at
https://andrewmarconi.github.io/twenty-mcp-suite/.

## Local development

```bash
pnpm --filter docs dev      # local dev server with hot reload
pnpm --filter docs build    # production build → .vitepress/dist
pnpm --filter docs preview  # preview the production build
```

## Deployment

Pushes to `main` that touch `apps/docs/**` trigger `.github/workflows/deploy-docs.yml`,
which builds the site and deploys it to GitHub Pages.

**One-time repo setup (manual):** in GitHub **Settings → Pages**, set **Source = GitHub Actions**.
Until that is set, the workflow runs but nothing is published.
```

- [ ] **Step 3: Validate the workflow file**

Run: `git add -A && pnpm --filter docs build`
Expected: the site still builds (sanity), and the workflow YAML is present.

Run: `node -e "require('node:fs').readFileSync('.github/workflows/deploy-docs.yml','utf8')" && echo "workflow present"`
Expected: prints `workflow present`.

(If `actionlint` is available, `actionlint .github/workflows/deploy-docs.yml` should pass; it is optional.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "ci(docs): GitHub Actions deploy to Pages + docs README"
```

- [ ] **Step 5: Operator step (not automatable)**

After merge to `main`: enable Pages in **Settings → Pages → Source = GitHub Actions**, then confirm the workflow run publishes and the site loads at `https://andrewmarconi.github.io/twenty-mcp-suite/` with working CSS/nav (validates the `base` path).

---

## Self-Review

**Spec coverage:**
- VitePress in `apps/docs` workspace package, isolated — Task 1. ✅
- `base: "/twenty-mcp-suite/"`, local search, nav/sidebar — Tasks 1–3. ✅
- Product docs (Guide) — Task 1; Tools — Task 2; Architecture + Reference — Task 3. ✅
- GitHub Actions deploy + manual Pages step — Task 4. ✅
- Content sourced from current README + foundation spec; `search`/`upsert` PROVISIONAL preserved — Tasks 2–3. ✅
- Out of scope (raw SDD on site, custom domain, versioning, auto-generated reference) — respected; nothing in the plan adds them.

**Placeholder scan:** Config, package.json, workflow, landing, and the `.gitignore`/scripts edits are complete code. Content pages are specified by outline + exact source + required facts (the appropriate form for authored prose, not a "TODO").

**Consistency:** Package name `docs` is used consistently (`pnpm --filter docs`), `base` string is identical everywhere, the sidebar keys (`/guide/`, `/tools/`, `/architecture/`, `/reference/`) match the created directories, and the workflow's artifact path (`apps/docs/.vitepress/dist`) matches the build output and the `.gitignore` entry. `packageManager` (Task 1) is what `pnpm/action-setup` relies on (Task 4).

**Note for the implementer:** VitePress fails the build on dead links, so never reference a page in nav/sidebar before its `.md` file exists — that is why nav/sidebar grow per task. If `pnpm --filter docs add -D vitepress` triggers `ERR_PNPM_IGNORED_BUILDS`, approve the named dep in `pnpm-workspace.yaml` rather than disabling the guard.
