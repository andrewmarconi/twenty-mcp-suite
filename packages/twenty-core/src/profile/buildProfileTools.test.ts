import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { buildProfileTools } from "./buildProfileTools.js";
import type { CapabilityProfile } from "./types.js";
import type { ToolDef } from "../tools/schemaTools.js";
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
const workflows: ObjectSchema = {
  nameSingular: "workflow",
  namePlural: "workflows",
  labelSingular: "Workflow",
  labelPlural: "Workflows",
  isActive: true,
  isSystem: true,
  isSearchable: false,
  fields: [],
};

// Fake cache: resolve() maps singular/plural to the object; throws for unknown.
function fakeCache() {
  const all = [people, workflows];
  return {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    resolve: (name: string) => {
      const o = all.find((x) => x.namePlural === name || x.nameSingular === name);
      if (!o) throw new Error(`Unknown object "${name}".`);
      return o;
    },
  } as any;
}

// Fake primitives that echo the args they received.
function primitives(): ToolDef[] {
  return [
    {
      name: "query_records",
      description: "Generic query.",
      inputSchema: z.object({ object: z.string(), filter: z.string().optional() }),
      handler: async (a) => JSON.stringify({ tool: "query", args: a }),
    },
    {
      name: "list_object_types",
      description: "List objects.",
      inputSchema: z.object({}),
      handler: async () =>
        JSON.stringify([
          { nameSingular: "person", namePlural: "people" },
          { nameSingular: "workflow", namePlural: "workflows" },
        ]),
    },
    {
      name: "search",
      description: "Search.",
      inputSchema: z.object({ query: z.string() }),
      handler: async (a) => JSON.stringify({ tool: "search", args: a }),
    },
  ];
}

const profile: CapabilityProfile = {
  name: "crm",
  objectScope: ["people"],
  tools: [
    { from: "list_object_types" },
    {
      from: "query_records",
      as: "find_contacts",
      bind: { object: "people" },
      description: "Find people.",
    },
    { from: "query_records" },
    { from: "search" },
  ],
};

describe("buildProfileTools", () => {
  it("aliases a tool, omits bound args from its schema, and injects the binding", async () => {
    const tools = buildProfileTools(profile, primitives(), fakeCache());
    const findContacts = tools.find((t) => t.name === "find_contacts")!;
    expect(findContacts.description).toBe("Find people.");
    // `object` was bound, so it is omitted from the exposed schema:
    expect("object" in (findContacts.inputSchema as z.ZodObject<any>).shape).toBe(false);
    const out = JSON.parse(await findContacts.handler({ filter: "name[eq]:Ada" }));
    expect(out.args).toEqual({ filter: "name[eq]:Ada", object: "people" });
  });

  it("refuses an out-of-scope object on a generic tool", async () => {
    const tools = buildProfileTools(profile, primitives(), fakeCache());
    const query = tools.find((t) => t.name === "query_records")!;
    await expect(query.handler({ object: "workflows" })).rejects.toThrow(
      /not available in the "crm" profile/,
    );
    // in-scope object passes:
    const ok = JSON.parse(await query.handler({ object: "people" }));
    expect(ok.tool).toBe("query");
  });

  it("filters list_object_types output to the scope", async () => {
    const tools = buildProfileTools(profile, primitives(), fakeCache());
    const list = tools.find((t) => t.name === "list_object_types")!;
    const out = JSON.parse(await list.handler({}));
    expect(out.map((o: { namePlural: string }) => o.namePlural)).toEqual(["people"]);
  });

  it("leaves a no-object tool (search) unscoped", async () => {
    const tools = buildProfileTools(profile, primitives(), fakeCache());
    const search = tools.find((t) => t.name === "search")!;
    const out = JSON.parse(await search.handler({ query: "acme" }));
    expect(out.tool).toBe("search");
  });

  it("throws on an unknown `from`", () => {
    const bad: CapabilityProfile = { name: "x", tools: [{ from: "nope" }] };
    expect(() => buildProfileTools(bad, primitives(), fakeCache())).toThrow(/unknown tool "nope"/);
  });

  it("throws on a duplicate exposed name", () => {
    const bad: CapabilityProfile = {
      name: "x",
      tools: [{ from: "search" }, { from: "query_records", as: "search" }],
    };
    expect(() => buildProfileTools(bad, primitives(), fakeCache())).toThrow(
      /duplicate tool name "search"/,
    );
  });
});
