import { describe, it, expect, vi } from "vitest";
import { writeTools } from "./writeTools.js";
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
function tool(name: string, rest: any) {
  return writeTools(rest, cache()).find((t) => t.name === name)!;
}

describe("writeTools", () => {
  it("create_records POSTs the array to the batch path", async () => {
    const rest = { post: vi.fn().mockResolvedValue({ data: { createPeople: [] } }) };
    await tool("create_records", rest).handler({ object: "people", records: [{ name: "Ada" }] });
    expect(rest.post).toHaveBeenCalledWith("/rest/batch/people", [{ name: "Ada" }]);
  });

  it("update_records PATCHes each record by id", async () => {
    const rest = { patch: vi.fn().mockResolvedValue({ data: {} }) };
    await tool("update_records", rest).handler({
      object: "people",
      records: [
        { id: "1", name: "A" },
        { id: "2", name: "B" },
      ],
    });
    expect(rest.patch).toHaveBeenNthCalledWith(1, "/rest/people/1", { name: "A" });
    expect(rest.patch).toHaveBeenNthCalledWith(2, "/rest/people/2", { name: "B" });
  });

  it("update_records rejects a record without an id", async () => {
    const rest = { patch: vi.fn() };
    await expect(
      tool("update_records", rest).handler({ object: "people", records: [{ name: "A" }] }),
    ).rejects.toThrow(/id/);
  });

  it("update_records issues no PATCHes when any record in the batch is missing an id", async () => {
    const rest = { patch: vi.fn() };
    await expect(
      tool("update_records", rest).handler({
        object: "people",
        records: [{ id: "1", name: "A" }, { name: "no-id" }],
      }),
    ).rejects.toThrow(/id/);
    expect(rest.patch).not.toHaveBeenCalled();
  });

  it("delete_records DELETEs each id", async () => {
    const rest = { del: vi.fn().mockResolvedValue({ data: {} }) };
    await tool("delete_records", rest).handler({ object: "people", ids: ["1", "2"] });
    expect(rest.del).toHaveBeenNthCalledWith(1, "/rest/people/1");
    expect(rest.del).toHaveBeenNthCalledWith(2, "/rest/people/2");
  });
});
