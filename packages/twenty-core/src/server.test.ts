import { describe, it, expect, vi } from "vitest";
import { buildTools, createSegmentServer } from "./server.js";
import { RestClient } from "./twenty/restClient.js";
import { GraphQLClient } from "./twenty/graphqlClient.js";
import { SchemaCache } from "./schema/cache.js";
import type { Connection } from "./auth/types.js";
import type { CapabilityProfile } from "./profile/types.js";

const conn: Connection = { label: "test", baseUrl: "https://x", getBearer: async () => "k" };

describe("buildTools", () => {
  it("exposes the full unique tool set", () => {
    const rest = new RestClient(conn, vi.fn() as unknown as typeof fetch);
    const gql = new GraphQLClient(conn, vi.fn() as unknown as typeof fetch);
    const cache = new SchemaCache(rest, vi.fn().mockResolvedValue([]));
    const names = buildTools(rest, gql, cache).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "create_records", "delete_records", "describe_object", "get_record",
        "list_object_types", "query_records", "refresh_schema", "search",
        "update_records", "upsert_records",
      ].sort(),
    );
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("createSegmentServer", () => {
  it("builds without throwing for a valid profile over the real primitives", () => {
    const conn: Connection = { label: "t", baseUrl: "https://x", getBearer: async () => "k" };
    const profile: CapabilityProfile = {
      name: "crm",
      objectScope: ["people"],
      tools: [{ from: "query_records", as: "find_contacts", bind: { object: "people" } }, { from: "search" }],
    };
    // Should wire without error (validates the profile references real primitive names).
    expect(() =>
      createSegmentServer(conn, profile, { name: "t", version: "0" }, vi.fn() as unknown as typeof fetch),
    ).not.toThrow();
  });

  it("rejects a profile that references an unknown primitive", () => {
    const conn: Connection = { label: "t", baseUrl: "https://x", getBearer: async () => "k" };
    const bad: CapabilityProfile = { name: "x", tools: [{ from: "does_not_exist" }] };
    expect(() =>
      createSegmentServer(conn, bad, { name: "t", version: "0" }, vi.fn() as unknown as typeof fetch),
    ).toThrow(/unknown tool "does_not_exist"/);
  });
});
