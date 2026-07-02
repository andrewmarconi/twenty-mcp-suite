import { z } from "zod";
import type { RestClient } from "../twenty/restClient.js";
import type { SchemaCache } from "../schema/cache.js";
import type { ToolDef } from "./schemaTools.js";
import { withDriftHandling } from "./helpers.js";

export function readTools(rest: RestClient, cache: SchemaCache): ToolDef[] {
  const queryShape = z.object({
    object: z.string(),
    filter: z.string().optional(),
    orderBy: z.string().optional(),
    limit: z.number().int().positive().max(60).optional(),
    depth: z.number().int().min(0).max(2).optional(),
    cursor: z.string().optional(),
  });

  return [
    {
      name: "query_records",
      description:
        "List records of one object with optional filter, orderBy, limit, depth (relations), and cursor pagination. Filter syntax: field[operator]:value, e.g. name[eq]:Acme.",
      inputSchema: queryShape,
      handler: async (args) => {
        const a = queryShape.parse(args);
        await cache.ensureLoaded();
        const obj = cache.resolve(a.object);
        return withDriftHandling(a.object, async () =>
          JSON.stringify(
            await rest.get(`/rest/${obj.namePlural}`, {
              filter: a.filter,
              orderBy: a.orderBy,
              limit: a.limit,
              depth: a.depth,
              starting_after: a.cursor,
            }),
          ),
        );
      },
    },
    {
      name: "get_record",
      description:
        "Fetch a single record by id. Optional depth (0–2) inlines related records one/two levels deep.",
      inputSchema: z.object({
        object: z.string(),
        id: z.string(),
        depth: z.number().int().min(0).max(2).optional(),
      }),
      handler: async (args) => {
        const a = z
          .object({
            object: z.string(),
            id: z.string(),
            depth: z.number().int().min(0).max(2).optional(),
          })
          .parse(args);
        await cache.ensureLoaded();
        const obj = cache.resolve(a.object);
        return withDriftHandling(a.object, async () =>
          JSON.stringify(await rest.get(`/rest/${obj.namePlural}/${a.id}`, { depth: a.depth })),
        );
      },
    },
    {
      name: "search",
      description: "Full-text search across searchable objects in Twenty.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().positive().max(60).optional(),
      }),
      handler: async (args) => {
        const a = z
          .object({ query: z.string(), limit: z.number().int().positive().max(60).optional() })
          .parse(args);
        // PROVISIONAL: the /rest/search query params (`q`, `limit`) and response envelope
        // are inferred, not yet confirmed against a live Twenty instance. Verify before
        // relying on this shape; adjust here if Twenty's actual contract differs.
        return JSON.stringify(await rest.get("/rest/search", { q: a.query, limit: a.limit }));
      },
    },
  ];
}
