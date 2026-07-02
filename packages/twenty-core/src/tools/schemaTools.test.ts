import { describe, it, expect, vi } from "vitest";
import { schemaTools } from "./schemaTools.js";
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
  fields: [
    {
      name: "name",
      type: "TEXT",
      isNullable: false,
      isUnique: false,
      isActive: true,
      isSystem: false,
    },
  ],
};

function cacheWith(objs: ObjectSchema[]) {
  return new SchemaCache({} as any, vi.fn().mockResolvedValue(objs));
}
function tool(name: string, cache: SchemaCache) {
  return schemaTools(cache).find((t) => t.name === name)!;
}

describe("schemaTools", () => {
  it("list_object_types returns a compact object list", async () => {
    const out = JSON.parse(await tool("list_object_types", cacheWith([people])).handler({}));
    expect(out).toEqual([
      { nameSingular: "person", namePlural: "people", labelPlural: "People", isSystem: false },
    ]);
  });

  it("describe_object returns the full schema for a resolved object", async () => {
    const out = JSON.parse(
      await tool("describe_object", cacheWith([people])).handler({ object: "people" }),
    );
    expect(out.namePlural).toBe("people");
    expect(out.fields[0].name).toBe("name");
  });

  it("refresh_schema reports the object count", async () => {
    const out = JSON.parse(await tool("refresh_schema", cacheWith([people])).handler({}));
    expect(out).toEqual({ refreshed: true, objectCount: 1 });
  });
});
