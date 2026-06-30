import { describe, it, expect } from "vitest";
import { fetchAllObjects } from "./metadata.js";
import fixtures from "../../tests/fixtures/metadata-objects.json";

function fakeRest(pages: unknown[]) {
  let call = 0;
  return {
    get: async () => pages[call++],
  } as unknown as import("../twenty/restClient.js").RestClient;
}

describe("fetchAllObjects", () => {
  it("paginates, drops inactive objects, and drops inactive fields", async () => {
    const rest = fakeRest([fixtures.page1, fixtures.page2]);
    const objects = await fetchAllObjects(rest);

    const names = objects.map((o) => o.namePlural).sort();
    expect(names).toEqual(["companies", "people"]); // oldThings dropped (inactive)

    const company = objects.find((o) => o.namePlural === "companies")!;
    expect(company.fields.map((f) => f.name)).toEqual(["name"]); // deletedField dropped
    expect(company.fields[0].type).toBe("TEXT");
  });
});
