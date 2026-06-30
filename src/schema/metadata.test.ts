import { describe, it, expect } from "vitest";
import { fetchAllObjects } from "./metadata.js";
import fixtures from "../../tests/fixtures/metadata-objects.json";

interface RecordedCall {
  path: string;
  query: Record<string, unknown> | undefined;
}

function fakeRest(pages: unknown[]) {
  let call = 0;
  const calls: RecordedCall[] = [];
  const rest = {
    get: async (path: string, query?: Record<string, unknown>) => {
      calls.push({ path, query });
      return pages[call++];
    },
  } as unknown as import("../twenty/restClient.js").RestClient;
  return { rest, calls };
}

describe("fetchAllObjects", () => {
  it("paginates, drops inactive objects, and drops inactive fields", async () => {
    const { rest, calls } = fakeRest([fixtures.page1, fixtures.page2]);
    const objects = await fetchAllObjects(rest);

    const names = objects.map((o) => o.namePlural).sort();
    expect(names).toEqual(["companies", "people"]); // oldThings dropped (inactive)

    const company = objects.find((o) => o.namePlural === "companies")!;
    expect(company.fields.map((f) => f.name)).toEqual(["name"]); // deletedField dropped
    expect(company.fields[0].type).toBe("TEXT");

    // Verify the cursor is actually forwarded between calls.
    expect(calls).toHaveLength(2);
    expect(calls[0].path).toBe("/rest/metadata/objects");
    expect(calls[0].query?.starting_after).toBeUndefined();
    expect(calls[1].path).toBe("/rest/metadata/objects");
    expect(calls[1].query?.starting_after).toBe(fixtures.page1.pageInfo.endCursor);
    expect(calls[1].query?.starting_after).toBe("CURSOR_1");
  });

  it("defaults omitted booleans (isActive, isNullable, isUnique, isSystem)", async () => {
    const { rest } = fakeRest([
      {
        data: [
          {
            nameSingular: "thing",
            namePlural: "things",
            labelSingular: "Thing",
            labelPlural: "Things",
            // isActive omitted -> should default to active and be kept
            fields: [
              { name: "name", type: "TEXT" }, // isNullable/isUnique/isSystem/isActive all omitted
            ],
          },
        ],
        pageInfo: { hasNextPage: false },
      },
    ]);

    const objects = await fetchAllObjects(rest);

    const thing = objects.find((o) => o.namePlural === "things");
    expect(thing).toBeDefined(); // omitted isActive -> kept/active

    const field = thing!.fields.find((f) => f.name === "name")!;
    expect(field.isNullable).toBe(true);
    expect(field.isUnique).toBe(false);
    expect(field.isSystem).toBe(false);
    expect(field.isActive).toBe(true);
  });
});
