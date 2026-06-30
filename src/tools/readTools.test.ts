import { describe, it, expect, vi } from "vitest";
import { readTools } from "./readTools.js";
import { SchemaCache } from "../schema/cache.js";
import { TwentyApiError } from "../twenty/errors.js";
import type { ObjectSchema } from "../schema/types.js";

const people: ObjectSchema = {
  nameSingular: "person", namePlural: "people",
  labelSingular: "Person", labelPlural: "People",
  isActive: true, isSystem: false, isSearchable: true, fields: [],
};
function cache() {
  return new SchemaCache({} as any, vi.fn().mockResolvedValue([people]));
}
function tool(name: string, rest: any) {
  return readTools(rest, cache()).find((t) => t.name === name)!;
}

describe("readTools", () => {
  it("query_records builds GET on the plural path with query params", async () => {
    const rest = { get: vi.fn().mockResolvedValue({ data: { people: [] } }) };
    await tool("query_records", rest).handler({
      object: "people", filter: "name[eq]:Ada", limit: 5,
    });
    expect(rest.get).toHaveBeenCalledWith("/rest/people", {
      filter: "name[eq]:Ada", orderBy: undefined, limit: 5, depth: undefined, starting_after: undefined,
    });
  });

  it("get_record fetches by id", async () => {
    const rest = { get: vi.fn().mockResolvedValue({ data: { person: { id: "1" } } }) };
    await tool("get_record", rest).handler({ object: "people", id: "1" });
    expect(rest.get).toHaveBeenCalledWith("/rest/people/1");
  });

  it("maps a drift error into a refresh_schema hint", async () => {
    const rest = {
      get: vi.fn().mockRejectedValue(new TwentyApiError("x", 404, {}, "/rest/people")),
    };
    await expect(
      tool("query_records", rest).handler({ object: "people" }),
    ).rejects.toThrow(/refresh_schema/);
  });
});
