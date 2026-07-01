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
