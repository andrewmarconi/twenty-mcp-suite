# Design: generic `aggregate` primitive for `twenty-core`

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan
**Issue:** #3 — Add generic `aggregate` primitive to twenty-core
**Prerequisite for:** #2 (Analytics segment)

## Problem

`twenty-core` exposes generic, schema-driven primitives for reads (`query_records`,
`get_record`, `search`), writes (`create`/`update`/`delete`), and batch `upsert_records`.
It has **no aggregation primitive**. The Analytics segment (#2) needs a generic
group-by / count / math building block that — like every other tool — encodes no object
or field names and adapts to the live schema. The foundation spec
(`2026-06-30-twenty-suite-foundation-design.md`) deferred `aggregate` to this cycle but
kept the seams (profile loader, `buildTools`, `withDriftHandling`) so it drops in without
redesign.

This spec adds that primitive: `aggregate`, a schema-aware GraphQL-backed tool that counts
and computes math/date/boolean aggregates over any object, optionally grouped by one field,
optionally filtered with the existing filter DSL.

## Scope

- **In:** the `aggregate` `ToolDef` factory, its zod input schema, schema-aware object/field
  resolution + field-existence validation, an isolated (PROVISIONAL) GraphQL query builder,
  unit tests, export from `index.ts`, and inclusion in `buildTools`.
- **Out (YAGNI):** wiring `aggregate` into `crmProfile` (CRM does not need it — the Analytics
  segment wires it in later); the Analytics segment itself; hardcoded field-type→op
  compatibility tables; live verification of the GraphQL wire shape (deferred — see below).

## Operations

`AggOp = count | sum | avg | min | max | earliest | latest | countTrue | countFalse`

- `count` — row count. `field` optional; when a `field` is given, counts non-null values of it.
- `sum` / `avg` / `min` / `max` — numeric aggregates; `field` required.
- `earliest` / `latest` — date aggregates (min/max over a date field); `field` required.
- `countTrue` / `countFalse` — boolean tallies; `field` required.

Twenty natively supports all of these (confirmed via its docs: Kanban column aggregations and
dashboard chart Y-axis math — Count, Sum, Average, Min, Max on number fields; Earliest/Latest
on dates; Count true/false on booleans). This primitive maps each op onto the matching
GraphQL aggregate selector.

**Op↔field-type compatibility is delegated to Twenty, not enforced locally.** The primitive
validates that a referenced field *exists* on the resolved object, then maps the op to its
selector. If an op is applied to an incompatible field type (e.g. `sum` on a text field),
Twenty returns the error, surfaced through `withDriftHandling`. This keeps the primitive
resilient to Twenty's evolving field-type vocabulary rather than coupling it to a hardcoded
type map.

## Input schema (zod)

```ts
const AGG_OPS = [
  "count", "sum", "avg", "min", "max", "earliest", "latest", "countTrue", "countFalse",
] as const;

const aggregateShape = z.object({
  object: z.string(),
  aggregations: z
    .array(
      z.object({
        op: z.enum(AGG_OPS),
        field: z.string().optional(),
        alias: z.string().optional(),
      }),
    )
    .min(1)
    .max(20),
  groupBy: z.string().optional(),
  filter: z.string().optional(),
});
```

- `aggregations` — 1–20 requested aggregates. `alias` is an optional output key for that
  aggregate; when omitted, a deterministic default key is derived (`<op>` for a fieldless
  count, else `<field>_<op>`).
- `groupBy` — a single field to group by (optional). When present, the result is one row per
  distinct group value; when absent, a single aggregate row over the (filtered) collection.
- `filter` — the same `field[operator]:value` DSL string that `query_records` accepts,
  forwarded to the GraphQL query's filter argument.

**Cross-field validation** (beyond zod, in the handler, after `cache.resolve`):
- every `field` in `aggregations` and the `groupBy` field must exist on the resolved
  object's schema (`obj.fields`); otherwise throw a clear error naming the field — **before**
  any network call.
- every op except `count` requires a `field`; `count` may omit it. A non-`count` op without a
  `field` throws a clear error.

## Architecture

`aggregate` is the **second GraphQL consumer** in `twenty-core` (the first is
`upsert_records`). It follows the exact `ToolDef` shape and the `upsertTool` isolation
pattern for its provisional wire format.

### New file: `packages/twenty-core/src/tools/aggregateTool.ts`

```ts
export function buildAggregateQuery(
  obj: ObjectSchema,
  args: { aggregations: {...}[]; groupBy?: string; filter?: string },
): { query: string; variables: Record<string, unknown> };

export function aggregateTool(gql: GraphQLClient, cache: SchemaCache): ToolDef;
```

- `buildAggregateQuery` is a **pure, exported, unit-testable** function that constructs the
  GraphQL from the resolved object + validated args. It carries a `// PROVISIONAL` comment
  block (mirroring `upsertTool`): the exact aggregate-field naming and query envelope are
  inferred from Twenty's GraphQL conventions and **not yet confirmed against a live
  instance** — isolating it here means a live correction is a single-function edit.
- `aggregateTool(gql, cache)` returns the `ToolDef`:
  - `name: "aggregate"`.
  - `description`: explains the op set, the `field[operator]:value` filter DSL, `groupBy`,
    and that math ops require numeric fields / date ops require date fields / boolean ops
    require boolean fields.
  - `handler`: `aggregateShape.parse(args)` → `cache.ensureLoaded()` → `cache.resolve(object)`
    → cross-field validation (above) → `buildAggregateQuery` → `withDriftHandling(object, …)`
    wrapping `gql.request(query, variables)` → return `JSON.stringify(data)`.

### Modified: `packages/twenty-core/src/server.ts`

`buildTools` adds `aggregateTool(gql, cache)` to the primitives array (after `upsertTool`).
The existing duplicate-name guard covers it. This makes `aggregate` part of the generic set:
`createServer` exposes it directly; `createSegmentServer` runs the primitives through
`buildProfileTools`, which exposes **only** the tools a profile lists — so the CRM segment
does **not** get `aggregate` unless `crmProfile` is edited (it is not, in this spec).

### Modified: `packages/twenty-core/src/index.ts`

Add `export { aggregateTool } from "./tools/aggregateTool.js";` (and `buildAggregateQuery` if
useful to consumers/tests). Every new public symbol is a named export here, per convention.

## Provisional GraphQL wire shape

Marked PROVISIONAL and isolated in `buildAggregateQuery`. The inferred shape is a single
query over the object's plural collection carrying the `filter` argument and (when present)
a `groupBy` argument, selecting `totalCount` and the requested per-field aggregate
selectors. The implementer encodes the most likely shape from Twenty's GraphQL conventions;
the exact selector names/envelope are **verified against a live instance in a later pass**
(same treatment as `upsert_records` and `search`), and the README's "provisional wire
formats" note is extended to list `aggregate`.

## Error handling

- **Unknown object** → `cache.resolve` throws; wrapped by `withDriftHandling`, which yields a
  message naming `refresh_schema` on drift-shaped failures.
- **Unknown / missing field** (aggregation field or `groupBy`), or a non-`count` op with no
  `field` → thrown before any network call, message names the offending field/op.
- **Bad `op`** → rejected by `z.enum` at parse time.
- **Op/type mismatch at the API** (e.g. `sum` on text) → Twenty error, surfaced via
  `withDriftHandling` / `TwentyApiError`.

## Testing

Unit tests only (vitest), injecting a fake `GraphQLClient` (records the `query`/`variables`
it receives) and a `SchemaCache` built from a fake loader — no network, matching the existing
`upsertTool.test.ts` / `readTools.test.ts` style.

- **Resolution:** a known object resolves and issues one `gql.request`; an unknown object
  throws (drift path) and issues **no** request.
- **Field validation:** an aggregation `field` not on the schema throws with the field name
  and issues no request; likewise an unknown `groupBy` field.
- **Op/field rules:** `sum` (or any non-`count` op) without a `field` throws; `count` without
  a field is accepted.
- **Query building (`buildAggregateQuery`, pure):** for `count` over an object, for
  `sum` on a numeric field, and for a `groupBy` case, assert the generated `query` string
  contains the resolved plural name, the filter/groupBy arguments when provided, and the
  expected aggregate selector(s); assert `variables` carry the filter.
- **Output:** the handler returns `JSON.stringify` of the fake gql's returned data.
- **Drift:** a drift-shaped error from `gql.request` is rethrown by `withDriftHandling` with a
  `refresh_schema` hint.
- **Wiring:** `buildTools(...)` includes a tool named `aggregate` and still passes its
  duplicate-name guard; a test asserts the `crmProfile` tool set does **not** include
  `aggregate` (CRM surface unchanged). The `server.test.ts` primitive-count expectation is
  updated to include the new tool.

## Out of scope (YAGNI)

- Wiring `aggregate` into `crmProfile` or any curated CRM alias.
- A hardcoded Twenty field-type → op compatibility table (existence-check only; Twenty
  enforces type compatibility).
- Live verification of the aggregate GraphQL shape (deferred, PROVISIONAL — like
  `upsert_records` / `search`).
- The Analytics segment (#2), business-named aggregate aliases, multi-field group-by, and
  HAVING-style post-aggregation filters.
