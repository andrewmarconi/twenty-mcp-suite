import { z } from "zod";
import type { ObjectSchema } from "../schema/types.js";
import type { GraphQLClient } from "../twenty/graphqlClient.js";
import type { SchemaCache } from "../schema/cache.js";
import type { ToolDef } from "./schemaTools.js";
import { withDriftHandling } from "./helpers.js";

export const AGG_OPS = [
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "earliest",
  "latest",
  "countTrue",
  "countFalse",
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
