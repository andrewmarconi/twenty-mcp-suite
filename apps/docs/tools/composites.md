# Composite reads

Two composite tools return a record together with its related data in a single call, so the assistant does not have to chain several lookups:

- **`get_contact_brief`** — one person (by id) plus their related company, notes, tasks, opportunities, and recent activity.
- **`get_account_snapshot`** — one company (by id) plus its related people, opportunities, notes, and tasks.

Each takes just an `id`:

```json
{ "name": "get_contact_brief", "arguments": { "id": "008b6654-90ab-48d5-8aa3-2ba697654d25" } }
```

## How they work

They are thin, depth-bound reads over `get_record`, using Twenty's native relation `depth` (one level). No bespoke logic and no recipe engine: the related records come straight from Twenty, so the composites stay resilient to schema changes. They were verified live against Twenty 2.17.2 — a `get_contact_brief` returns the person with a nested `company` object plus related message, timeline, and task records inlined.

If you need a different shape, `get_record` accepts an explicit `depth` (0–2) on any in-scope object, and `query_records` accepts `depth` for lists.
