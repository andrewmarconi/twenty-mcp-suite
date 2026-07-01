# Generic `aggregate` primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic, schema-aware `aggregate` primitive to `twenty-core` (count / sum / avg / min / max / earliest / latest / countTrue / countFalse over any object, optional group-by + filter), exposed via `buildTools` but not the CRM profile.

**Architecture:** A new `aggregateTool.ts` in `twenty-core` with a pure, isolated (PROVISIONAL) GraphQL builder `buildAggregateQuery` and an `aggregateTool(gql, cache)` `ToolDef` that resolves the object + validates field existence against the live schema, then delegates op↔type compatibility to Twenty. It is the second GraphQL consumer (after `upsert_records`) and follows the `upsertTool` isolation pattern for its provisional wire format. Wired into `buildTools`; `createServer` exposes it, `createSegmentServer` + `crmProfile` do not.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), pnpm workspaces, vitest, zod, dependency-injected fakes (no network in tests).

## Global Constraints

- Node **>= 22**; package manager is **pnpm**, not npm.
- **ESM with `.js` import extensions** on local imports; every new public symbol is a named export in `packages/twenty-core/src/index.ts`.
- **Tools are generic and schema-driven** — encode no object or field names; resolve via `SchemaCache`.
- **REST-first, GraphQL only where required.** `aggregate` is GraphQL (the second consumer after `upsert_records`).
- **Provisional wire formats are isolated + commented** `// PROVISIONAL` and listed in the README/docs provisional note — verified against a live instance later, not in this plan.
- **Op↔field-type compatibility is delegated to Twenty**, not enforced locally; validate field *existence* only.
- **Not wired into `crmProfile`** — CRM surface stays unchanged.
- **Tests inject fakes, never hit the network.** Tool handlers return JSON strings; assert via `JSON.parse`. Run one package's suite with `pnpm --filter twenty-core test`.

---

### Task 1: `buildAggregateQuery` — pure GraphQL builder

**Files:**
- Create: `packages/twenty-core/src/tools/aggregateTool.ts`
- Test: `packages/twenty-core/src/tools/aggregateTool.test.ts`

**Interfaces:**
- Consumes: `ObjectSchema` from `../schema/types.js`.
- Produces:
  ```ts
  export const AGG_OPS: readonly ["count","sum","avg","min","max","earliest","latest","countTrue","countFalse"];
  export type AggOp = (typeof AGG_OPS)[number];
  export interface AggregationSpec { op: AggOp; field?: string; alias?: string; }
  export function aggregationAlias(agg: AggregationSpec): string;
  export function buildAggregateQuery(
    obj: ObjectSchema,
    args: { aggregations: AggregationSpec[]; groupBy?: string; filter?: string },
  ): { query: string; variables: Record<string, unknown> };
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/twenty-core/src/tools/aggregateTool.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildAggregateQuery, aggregationAlias } from "./aggregateTool.js";
import type { ObjectSchema } from "../schema/types.js";

const opportunities: ObjectSchema = {
  nameSingular: "opportunity", namePlural: "opportunities",
  labelSingular: "Opportunity", labelPlural: "Opportunities",
  isActive: true, isSystem: false, isSearchable: true,
  fields: [
    { name: "amount", type: "NUMBER", isNullable: true, isUnique: false, isActive: true, isSystem: false },
    { name: "stage", type: "SELECT", isNullable: true, isUnique: false, isActive: true, isSystem: false },
    { name: "closeDate", type: "DATE_TIME", isNullable: true, isUnique: false, isActive: true, isSystem: false },
    { name: "won", type: "BOOLEAN", isNullable: true, isUnique: false, isActive: true, isSystem: false },
  ],
};

describe("aggregationAlias", () => {
  it("uses an explicit alias when given", () => {
    expect(aggregationAlias({ op: "sum", field: "amount", alias: "total" })).toBe("total");
  });
  it("derives <field>_<op> when a field is present", () => {
    expect(aggregationAlias({ op: "sum", field: "amount" })).toBe("amount_sum");
  });
  it("derives <op> for a fieldless count", () => {
    expect(aggregationAlias({ op: "count" })).toBe("count");
  });
});

describe("buildAggregateQuery", () => {
  it("maps a fieldless count to totalCount and queries the plural collection", () => {
    const { query, variables } = buildAggregateQuery(opportunities, {
      aggregations: [{ op: "count" }],
    });
    expect(query).toContain("opportunities");
    expect(query).toContain("count: totalCount");
    expect(variables).toEqual({});
  });

  it("builds a per-field aggregate selector for sum", () => {
    const { query } = buildAggregateQuery(opportunities, {
      aggregations: [{ op: "sum", field: "amount" }],
    });
    expect(query).toContain("amount_sum: amount { sum }");
  });

  it("maps earliest/latest onto min/max selectors", () => {
    const { query } = buildAggregateQuery(opportunities, {
      aggregations: [{ op: "earliest", field: "closeDate" }, { op: "latest", field: "closeDate" }],
    });
    expect(query).toContain("closeDate_earliest: closeDate { min }");
    expect(query).toContain("closeDate_latest: closeDate { max }");
  });

  it("emits a groupBy argument and selection when grouping", () => {
    const { query } = buildAggregateQuery(opportunities, {
      aggregations: [{ op: "count" }],
      groupBy: "stage",
    });
    expect(query).toContain('groupBy: ["stage"]');
    expect(query).toMatch(/\n\s*stage\n/); // bare group field selection
  });

  it("carries the filter as a variable and declares it", () => {
    const { query, variables } = buildAggregateQuery(opportunities, {
      aggregations: [{ op: "count" }],
      filter: "stage[eq]:NEW",
    });
    expect(query).toContain("($filter: String)");
    expect(query).toContain("filter: $filter");
    expect(variables).toEqual({ filter: "stage[eq]:NEW" });
  });

  it("honors an explicit alias in the selection", () => {
    const { query } = buildAggregateQuery(opportunities, {
      aggregations: [{ op: "avg", field: "amount", alias: "avgDeal" }],
    });
    expect(query).toContain("avgDeal: amount { avg }");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter twenty-core test aggregateTool`
Expected: FAIL — `buildAggregateQuery is not a function` / module has no exports.

- [ ] **Step 3: Implement the builder**

Create `packages/twenty-core/src/tools/aggregateTool.ts` with (tool factory added in Task 2):

```ts
import type { ObjectSchema } from "../schema/types.js";

export const AGG_OPS = [
  "count", "sum", "avg", "min", "max", "earliest", "latest", "countTrue", "countFalse",
] as const;
export type AggOp = (typeof AGG_OPS)[number];

export interface AggregationSpec {
  op: AggOp;
  field?: string;
  alias?: string;
}

// Map an op to its PROVISIONAL GraphQL aggregate selector keyword.
function aggSelector(op: AggOp): string {
  switch (op) {
    case "earliest":
      return "min";
    case "latest":
      return "max";
    default:
      return op; // sum | avg | min | max | count | countTrue | countFalse
  }
}

export function aggregationAlias(agg: AggregationSpec): string {
  if (agg.alias) return agg.alias;
  return agg.field ? `${agg.field}_${agg.op}` : agg.op;
}

export function buildAggregateQuery(
  obj: ObjectSchema,
  args: { aggregations: AggregationSpec[]; groupBy?: string; filter?: string },
): { query: string; variables: Record<string, unknown> } {
  // PROVISIONAL: Twenty's aggregate GraphQL contract is inferred from its conventions and
  // NOT yet confirmed against a live instance. Specifically unverified: (1) the collection
  // aggregate-selector shape (`<field> { sum avg ... }` vs connection-level fields),
  // (2) the `groupBy` argument form and the result envelope, and (3) the `filter` variable
  // type + whether the REST filter DSL must be translated to a GraphQL FilterInput. All of
  // it is isolated here so a live correction is a single-function edit (cf. upsertTool).
  const { aggregations, groupBy, filter } = args;

  const selections: string[] = [];
  for (const agg of aggregations) {
    const alias = aggregationAlias(agg);
    if (agg.op === "count" && !agg.field) {
      selections.push(`${alias}: totalCount`);
    } else {
      selections.push(`${alias}: ${agg.field} { ${aggSelector(agg.op)} }`);
    }
  }

  const argParts: string[] = [];
  if (filter) argParts.push("filter: $filter");
  if (groupBy) argParts.push(`groupBy: [${JSON.stringify(groupBy)}]`);
  const argClause = argParts.length ? `(${argParts.join(", ")})` : "";

  const groupSel = groupBy ? `${groupBy}\n    ` : "";
  const varDecl = filter ? "($filter: String)" : "";

  const query = `query Aggregate${varDecl} {
  ${obj.namePlural}${argClause} {
    ${groupSel}${selections.join("\n    ")}
  }
}`;
  return { query, variables: filter ? { filter } : {} };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter twenty-core test aggregateTool`
Expected: PASS (all `buildAggregateQuery` / `aggregationAlias` cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/twenty-core/src/tools/aggregateTool.ts packages/twenty-core/src/tools/aggregateTool.test.ts
git commit -m "feat(core): add provisional aggregate GraphQL query builder (#3)"
```

---

### Task 2: `aggregateTool` — the schema-aware `ToolDef`

**Files:**
- Modify: `packages/twenty-core/src/tools/aggregateTool.ts` (add imports + `aggregateTool`)
- Test: `packages/twenty-core/src/tools/aggregateTool.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `buildAggregateQuery` / `AGG_OPS` (Task 1); `GraphQLClient` (`../twenty/graphqlClient.js`), `SchemaCache` (`../schema/cache.js`), `ToolDef` (`./schemaTools.js`), `withDriftHandling` (`./helpers.js`).
- Produces:
  ```ts
  export function aggregateTool(gql: GraphQLClient, cache: SchemaCache): ToolDef; // name: "aggregate"
  ```
  Handler returns `0`-free: a JSON string of the GraphQL data on success; throws (before any network call) on an unknown field or a non-`count` op with no field; drift-shaped GraphQL errors are rethrown by `withDriftHandling` naming `refresh_schema`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/twenty-core/src/tools/aggregateTool.test.ts`:

```ts
import { vi } from "vitest";
import { aggregateTool } from "./aggregateTool.js";
import { SchemaCache } from "../schema/cache.js";
import { TwentyApiError } from "../twenty/errors.js";

function cache() {
  return new SchemaCache({} as never, vi.fn().mockResolvedValue([opportunities]));
}

describe("aggregate tool", () => {
  it("resolves the object and issues one GraphQL request, returning its data as JSON", async () => {
    const data = { opportunities: { count: 3 } };
    const gql = { request: vi.fn().mockResolvedValue(data) };
    const tool = aggregateTool(gql as never, cache());
    const out = JSON.parse(await tool.handler({ object: "opportunities", aggregations: [{ op: "count" }] }));
    expect(gql.request).toHaveBeenCalledTimes(1);
    expect(out).toEqual(data);
  });

  it("accepts a fieldless count", async () => {
    const gql = { request: vi.fn().mockResolvedValue({}) };
    const tool = aggregateTool(gql as never, cache());
    await expect(
      tool.handler({ object: "opportunities", aggregations: [{ op: "count" }] }),
    ).resolves.toBeTypeOf("string");
  });

  it("throws on an unknown object and makes no GraphQL call", async () => {
    const gql = { request: vi.fn() };
    const tool = aggregateTool(gql as never, cache());
    await expect(
      tool.handler({ object: "nope", aggregations: [{ op: "count" }] }),
    ).rejects.toThrow(/nope/);
    expect(gql.request).not.toHaveBeenCalled();
  });

  it("throws on an unknown aggregation field and makes no GraphQL call", async () => {
    const gql = { request: vi.fn() };
    const tool = aggregateTool(gql as never, cache());
    await expect(
      tool.handler({ object: "opportunities", aggregations: [{ op: "sum", field: "bogus" }] }),
    ).rejects.toThrow(/bogus/);
    expect(gql.request).not.toHaveBeenCalled();
  });

  it("throws on an unknown groupBy field and makes no GraphQL call", async () => {
    const gql = { request: vi.fn() };
    const tool = aggregateTool(gql as never, cache());
    await expect(
      tool.handler({ object: "opportunities", aggregations: [{ op: "count" }], groupBy: "bogus" }),
    ).rejects.toThrow(/bogus/);
    expect(gql.request).not.toHaveBeenCalled();
  });

  it("throws when a non-count op has no field", async () => {
    const gql = { request: vi.fn() };
    const tool = aggregateTool(gql as never, cache());
    await expect(
      tool.handler({ object: "opportunities", aggregations: [{ op: "sum" }] }),
    ).rejects.toThrow(/requires a field/);
    expect(gql.request).not.toHaveBeenCalled();
  });

  it("rethrows a drift-shaped GraphQL error with a refresh_schema hint", async () => {
    const gql = {
      request: vi.fn().mockRejectedValue(new TwentyApiError("boom", 404, {}, "https://x/graphql")),
    };
    const tool = aggregateTool(gql as never, cache());
    await expect(
      tool.handler({ object: "opportunities", aggregations: [{ op: "count" }] }),
    ).rejects.toThrow(/refresh_schema/);
  });

  it("rejects a bad op at parse time", async () => {
    const gql = { request: vi.fn() };
    const tool = aggregateTool(gql as never, cache());
    await expect(
      tool.handler({ object: "opportunities", aggregations: [{ op: "median", field: "amount" }] }),
    ).rejects.toThrow();
    expect(gql.request).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter twenty-core test aggregateTool`
Expected: FAIL — `aggregateTool is not a function`.

- [ ] **Step 3: Implement `aggregateTool`**

At the top of `packages/twenty-core/src/tools/aggregateTool.ts`, add imports:

```ts
import { z } from "zod";
import type { GraphQLClient } from "../twenty/graphqlClient.js";
import type { SchemaCache } from "../schema/cache.js";
import type { ToolDef } from "./schemaTools.js";
import { withDriftHandling } from "./helpers.js";
```

Then append the tool factory to the same file:

```ts
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

export function aggregateTool(gql: GraphQLClient, cache: SchemaCache): ToolDef {
  return {
    name: "aggregate",
    description:
      "Aggregate over one object: count rows and compute sum/avg/min/max (number fields), " +
      "earliest/latest (date fields), or countTrue/countFalse (boolean fields), optionally " +
      "grouped by one field and filtered. Filter syntax: field[operator]:value, e.g. " +
      "stage[eq]:NEW. Each aggregation is {op, field?, alias?}; only count may omit field.",
    inputSchema: aggregateShape,
    handler: async (args) => {
      const a = aggregateShape.parse(args);
      await cache.ensureLoaded();
      const obj = cache.resolve(a.object);

      const fieldNames = new Set(obj.fields.map((f) => f.name));
      for (const agg of a.aggregations) {
        if (agg.op !== "count" && !agg.field) {
          throw new Error(`Aggregation "${agg.op}" requires a field.`);
        }
        if (agg.field && !fieldNames.has(agg.field)) {
          throw new Error(`Unknown field "${agg.field}" on object "${a.object}".`);
        }
      }
      if (a.groupBy && !fieldNames.has(a.groupBy)) {
        throw new Error(`Unknown groupBy field "${a.groupBy}" on object "${a.object}".`);
      }

      const { query, variables } = buildAggregateQuery(obj, {
        aggregations: a.aggregations,
        groupBy: a.groupBy,
        filter: a.filter,
      });
      return withDriftHandling(a.object, async () =>
        JSON.stringify(await gql.request(query, variables)),
      );
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter twenty-core test aggregateTool`
Expected: PASS (builder + tool blocks all green).

- [ ] **Step 5: Commit**

```bash
git add packages/twenty-core/src/tools/aggregateTool.ts packages/twenty-core/src/tools/aggregateTool.test.ts
git commit -m "feat(core): add schema-aware aggregate tool (#3)"
```

---

### Task 3: Wire into `buildTools`, export, and keep it out of the CRM surface

**Files:**
- Modify: `packages/twenty-core/src/server.ts` (import + add to `buildTools`)
- Modify: `packages/twenty-core/src/index.ts` (named exports)
- Modify: `packages/twenty-core/src/server.test.ts` (expected tool-name list)
- Modify: `packages/twenty-crm-mcp/src/profile.test.ts` (assert CRM excludes `aggregate`)
- Modify: `packages/twenty-crm-mcp/README.md` and `apps/docs/reference/compatibility.md` (provisional note)

**Interfaces:**
- Consumes: `aggregateTool` (Task 2).
- Produces: `buildTools` now returns a tool named `aggregate`; `aggregateTool` and `buildAggregateQuery` are exported from `twenty-core`.

- [ ] **Step 1: Update the failing tests first**

In `packages/twenty-core/src/server.test.ts`, add `"aggregate"` to the expected list (inside the `.toEqual([...])`):

```ts
    expect(names).toEqual(
      [
        "aggregate", "create_records", "delete_records", "describe_object", "get_record",
        "list_object_types", "query_records", "refresh_schema", "search",
        "update_records", "upsert_records",
      ].sort(),
    );
```

In `packages/twenty-crm-mcp/src/profile.test.ts`, add a test (import `crmProfile` from `./profile.js` if not already imported):

```ts
it("does not expose the aggregate primitive (analytics-only)", () => {
  expect(crmProfile.tools.some((t) => t.from === "aggregate")).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter twenty-core test server && pnpm --filter twenty-crm-mcp test profile`
Expected: the `twenty-core` `buildTools` test FAILS (list lacks `aggregate` in the actual output); the `twenty-crm-mcp` profile test PASSES already (crmProfile has no aggregate) — that's fine, it's a guard that must keep passing.

- [ ] **Step 3: Wire `aggregate` into `buildTools` and export it**

In `packages/twenty-core/src/server.ts`, add the import (next to the other tool imports):

```ts
import { aggregateTool } from "./tools/aggregateTool.js";
```

and add it to the `tools` array in `buildTools` (after `upsertTool(gql, cache)`):

```ts
  const tools = [
    ...schemaTools(cache),
    ...readTools(rest, cache),
    ...writeTools(rest, cache),
    upsertTool(gql, cache),
    aggregateTool(gql, cache),
  ];
```

In `packages/twenty-core/src/index.ts`, add after the `upsertTool` export line:

```ts
export { aggregateTool, buildAggregateQuery } from "./tools/aggregateTool.js";
export type { AggOp, AggregationSpec } from "./tools/aggregateTool.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter twenty-core test && pnpm --filter twenty-crm-mcp test`
Expected: both suites PASS — `buildTools` now lists `aggregate`; the CRM profile guard still passes.

- [ ] **Step 5: Extend the provisional-wire-format note**

Locate the existing provisional note (it lists `search` and `upsert_records`) and add `aggregate`:

Run: `grep -n -i "provisional" packages/twenty-crm-mcp/README.md apps/docs/reference/compatibility.md`

In each, add `aggregate` to the sentence/list that names the provisional wire formats, e.g. change a phrase like "the `search` path and the `upsert_records` mutation" to "the `search` path, the `upsert_records` mutation, and the `aggregate` query". Match the surrounding wording; do not hard-wrap prose beyond the file's existing convention.

- [ ] **Step 6: Full build + suite**

Run: `pnpm -r test && pnpm --filter twenty-core build && pnpm --filter twenty-crm-mcp build`
Expected: all tests PASS; both builds succeed (confirms the new exports and `buildTools` change typecheck).

- [ ] **Step 7: Commit**

```bash
git add packages/twenty-core/src/server.ts packages/twenty-core/src/index.ts packages/twenty-core/src/server.test.ts packages/twenty-crm-mcp/src/profile.test.ts packages/twenty-crm-mcp/README.md apps/docs/reference/compatibility.md
git commit -m "feat(core): expose aggregate in buildTools; keep it out of the CRM profile (#3)"
```

---

## Notes for the implementer

- **`aggregateTool.ts` is one file** holding both `buildAggregateQuery` (pure, Task 1) and `aggregateTool` (Task 2). Task 2 adds imports at the top and the factory at the bottom; do not split the file.
- **Field validation is existence-only.** Do not add a field-type→op compatibility table — an incompatible op/field (e.g. `sum` on a text field) is left for Twenty to reject, surfaced through `withDriftHandling`.
- **PROVISIONAL wire.** The generated GraphQL is an inferred shape, isolated in `buildAggregateQuery` with the `// PROVISIONAL` block. The tests assert the builder's *own* output (containment), not Twenty's real contract — live verification is a later pass, out of scope here.
- **Do not edit `crmProfile`** in `packages/twenty-crm-mcp/src/profile.ts` — the exclusion is the point. Only its test file gains a guard.
- **`TwentyApiError` constructor** is `new TwentyApiError(message, status, body, url)`; status `404` is drift-shaped, so `withDriftHandling` rethrows with the `refresh_schema` hint.
- **Keep test imports at the top of the file.** When Task 2 adds `vi`, `aggregateTool`, `SchemaCache`, `TwentyApiError`, consolidate them into the existing top-of-file import block rather than leaving mid-file `import` statements (ESM hoists them, but top-of-file matches convention).
