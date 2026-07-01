import { describe, it, expect, vi } from "vitest";
import { buildAggregateQuery, aggregationAlias, aggregateTool } from "./aggregateTool.js";
import type { ObjectSchema } from "../schema/types.js";
import { SchemaCache } from "../schema/cache.js";
import { TwentyApiError } from "../twenty/errors.js";

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
      request: vi
        .fn()
        .mockRejectedValue(
          new TwentyApiError("boom", 404, { messages: ["cannot find object opportunities"] }, "https://x/graphql"),
        ),
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
