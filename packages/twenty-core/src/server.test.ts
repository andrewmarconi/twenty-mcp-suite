import { describe, it, expect, vi } from "vitest";
import { buildTools } from "./server.js";
import { RestClient } from "./twenty/restClient.js";
import { GraphQLClient } from "./twenty/graphqlClient.js";
import { SchemaCache } from "./schema/cache.js";
import type { Connection } from "./auth/types.js";

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
