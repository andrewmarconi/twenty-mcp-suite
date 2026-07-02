import { describe, it, expect, vi } from "vitest";
import { upsertTool, upsertMutationName } from "./upsertTool.js";
import { SchemaCache } from "../schema/cache.js";
import type { ObjectSchema } from "../schema/types.js";

const people: ObjectSchema = {
  nameSingular: "person",
  namePlural: "people",
  labelSingular: "Person",
  labelPlural: "People",
  isActive: true,
  isSystem: false,
  isSearchable: true,
  fields: [],
};
function cache() {
  return new SchemaCache({} as any, vi.fn().mockResolvedValue([people]));
}

describe("upsertMutationName", () => {
  it("builds a PascalCase plural create mutation name", () => {
    expect(upsertMutationName("people")).toBe("createPeople");
    expect(upsertMutationName("companyDeals")).toBe("createCompanyDeals");
  });
});

describe("upsert_records", () => {
  it("calls GraphQL with the upsert mutation and record data", async () => {
    const gql = { request: vi.fn().mockResolvedValue({ createPeople: [{ id: "1" }] }) };
    const tool = upsertTool(gql as any, cache());
    const out = JSON.parse(
      await tool.handler({ object: "people", records: [{ id: "1", name: "Ada" }] }),
    );
    expect(gql.request).toHaveBeenCalledTimes(1);
    const [query, variables] = gql.request.mock.calls[0];
    expect(query).toContain("createPeople");
    expect(query).toContain("upsert: true");
    expect(variables).toEqual({ data: [{ id: "1", name: "Ada" }] });
    expect(out).toEqual([{ id: "1" }]);
  });
});
