import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { buildProfileTools, type ToolDef } from "twenty-core";
import { crmProfile } from "./profile.js";

// Minimal fakes of the 10 core primitive names so we can validate the profile's `from` references.
function corePrimitives(): ToolDef[] {
  const names = [
    "list_object_types", "describe_object", "refresh_schema",
    "query_records", "get_record", "search",
    "create_records", "update_records", "delete_records", "upsert_records",
  ];
  return names.map((name) => ({
    name,
    description: `${name} primitive.`,
    inputSchema: z.object({ object: z.string().optional(), id: z.string().optional(), depth: z.number().optional() }),
    handler: async () => "[]",
  }));
}

const cache = { ensureLoaded: vi.fn().mockResolvedValue(undefined), resolve: () => ({ namePlural: "people", nameSingular: "person" }) } as any;

describe("crmProfile", () => {
  it("scopes to the five core CRM objects and excludes system objects", () => {
    expect(crmProfile.objectScope).toEqual(["people", "companies", "opportunities", "tasks", "notes"]);
    expect(crmProfile.objectScope).not.toContain("workflows");
  });

  it("references only real primitives and exposes unique, business-named tools", () => {
    const tools = buildProfileTools(crmProfile, corePrimitives(), cache);
    const names = tools.map((t) => t.name);
    expect(names).toContain("find_contacts");
    expect(names).toContain("find_companies");
    expect(new Set(names).size).toBe(names.length); // unique
    // building did not throw → every `from` maps to a real primitive
  });

  it("does not expose the aggregate primitive (analytics-only)", () => {
    expect(crmProfile.tools.some((t) => t.from === "aggregate")).toBe(false);
  });

  it("exposes depth-bound composite reads that take only an id", () => {
    const tools = buildProfileTools(crmProfile, corePrimitives(), cache);
    const brief = tools.find((t) => t.name === "get_contact_brief")!;
    const snapshot = tools.find((t) => t.name === "get_account_snapshot")!;
    expect(brief).toBeDefined();
    expect(snapshot).toBeDefined();
    // object + depth are bound, so they are omitted from the exposed schema (only `id` remains):
    const briefShape = (brief.inputSchema as import("zod").ZodObject<any>).shape;
    expect("object" in briefShape).toBe(false);
    expect("depth" in briefShape).toBe(false);
    expect("id" in briefShape).toBe(true);
  });
});
