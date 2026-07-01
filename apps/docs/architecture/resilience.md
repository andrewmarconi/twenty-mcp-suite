# Resilience

The whole point of this server is to survive Twenty schema and version changes without a code release.

## Metadata-driven

Object and field names are never hardcoded. On first use, the server loads your live schema from Twenty's Metadata API into an in-memory cache, and every tool resolves its target object against that cache at call time. A custom object or field you add in Twenty is usable immediately — no code change, no release.

## Explicit drift recovery

When the schema changes underneath a cached session, a drift-shaped error tells the model to call `refresh_schema`, which reloads the live schema; the model then retries. Recovery is explicit rather than auto-healed, which keeps behavior predictable and avoids masking real data errors as schema drift.

## Nothing schema-specific is compiled in

Even the curated CRM surface is configuration (a capability profile) resolved against the live schema, and the OAuth layer adapts to your instance through discovery. So the code carries mechanism, not assumptions about your particular Twenty — which is what lets one build serve many instances and versions.
