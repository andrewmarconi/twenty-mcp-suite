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
    inputSchema: z.object({ object: z.string().optional() }),
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
});
