# Roadmap

The CRM segment is complete and live-verified. The suite is designed so further segments arrive as separate, opt-in capability packs over the same `twenty-core` engine, each with its own scoped tool surface. A segment is mostly declarative — a capability profile plus recipes — so new handler code is written only when a genuinely new primitive is required.

Planned (intent, not commitments):

- **Ops** — health checks, workspace export/snapshot, schema diff (the engine already fetches schema, so diffs are cheap), and guarded administrative actions with dry-run support. Workspace governance lives here too: roles, members, API keys, and webhooks. This is the differentiator for self-hosted teams.
- **Analytics** — pipeline summaries, stage aging, and activity trends, built on the generic `aggregate` primitive (now in `twenty-core`) and higher-level read models rather than raw record access.
- **Data** — bulk data work, kept distinct from Ops's operational snapshots: imports and ETL, CSV in and out, and record de-duplication and merging. The "get data in and keep it clean" surface.

Each segment is installed only when a team needs it, so an everyday CRM session never carries admin, analytics, or bulk-data tools it will not use.

Under consideration — unconfirmed; each needs its Twenty API path verified before it earns a spec:

- **Schema authoring** — creating custom objects and fields through Twenty's Metadata API (the engine already reads it; this would write it). Powerful but schema-mutating, so it may instead land as a guarded corner of Ops rather than a segment of its own.
- **Workflow** — triggering and inspecting Twenty's native workflows and AI actions.
