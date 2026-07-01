# Roadmap

The CRM segment is complete and live-verified. The suite is designed so further segments arrive as separate, opt-in capability packs over the same `twenty-core` engine, each with its own scoped tool surface.

Planned (intent, not commitments):

- **Ops** — health checks, workspace export/snapshot, schema diff (the engine already fetches schema, so diffs are cheap), and guarded administrative actions with dry-run support. This is the differentiator for self-hosted teams.
- **Analytics** — pipeline summaries, stage aging, and activity trends, built on a generic aggregation primitive and higher-level read models rather than raw record access.

Each segment is installed only when a team needs it, so an everyday CRM session never carries admin or analytics tools it will not use.
