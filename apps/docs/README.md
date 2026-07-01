# Docs site (VitePress)

The `twenty-mcp-suite` documentation site, deployed to GitHub Pages at
<https://andrewmarconi.github.io/twenty-mcp-suite/>.

## Local development

From the repo root:

    pnpm --filter docs dev      # local dev server with hot reload
    pnpm --filter docs build    # production build → .vitepress/dist
    pnpm --filter docs preview  # preview the production build

(`pnpm docs:dev` / `pnpm docs:build` at the root are shortcuts for the first two.)

## Deployment

Pushes to `main` that touch `apps/docs/**` trigger
[`.github/workflows/deploy-docs.yml`](../../.github/workflows/deploy-docs.yml), which builds
the site and deploys it to GitHub Pages.

**One-time repo setup (manual):** in GitHub **Settings → Pages**, set **Source = GitHub
Actions**. Until that is set, the workflow runs but nothing is published.
