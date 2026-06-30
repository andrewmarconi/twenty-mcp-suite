import { z } from "zod";
import type { RestClient } from "../twenty/restClient.js";
import type { SchemaCache } from "../schema/cache.js";
import type { ToolDef } from "./schemaTools.js";
import { withDriftHandling } from "./helpers.js";

const recordArray = z.array(z.record(z.string(), z.unknown())).min(1).max(60);

export function writeTools(rest: RestClient, cache: SchemaCache): ToolDef[] {
  return [
    {
      name: "create_records",
      description: "Create 1–60 records of one object in a single batch.",
      inputSchema: z.object({ object: z.string(), records: recordArray }),
      handler: async (args) => {
        const a = z.object({ object: z.string(), records: recordArray }).parse(args);
        await cache.ensureLoaded();
        const obj = cache.resolve(a.object);
        return withDriftHandling(a.object, async () =>
          JSON.stringify(await rest.post(`/rest/batch/${obj.namePlural}`, a.records)),
        );
      },
    },
    {
      name: "update_records",
      description: "Update 1–60 records of one object. Each record MUST include its id.",
      inputSchema: z.object({ object: z.string(), records: recordArray }),
      handler: async (args) => {
        const a = z.object({ object: z.string(), records: recordArray }).parse(args);
        await cache.ensureLoaded();
        const obj = cache.resolve(a.object);
        return withDriftHandling(a.object, async () => {
          // Validate every record has an id BEFORE issuing any PATCH, so a
          // batch with a bad record (e.g. missing id) never partially
          // applies earlier records' writes.
          for (const record of a.records) {
            const { id } = record as { id?: string };
            if (!id) throw new Error("Each record in update_records must include an id.");
          }
          const results = [];
          for (const record of a.records) {
            const { id, ...rest_ } = record as { id?: string };
            results.push(await rest.patch(`/rest/${obj.namePlural}/${id}`, rest_));
          }
          return JSON.stringify(results);
        });
      },
    },
    {
      name: "delete_records",
      description: "Delete 1–60 records of one object by id.",
      inputSchema: z.object({ object: z.string(), ids: z.array(z.string()).min(1).max(60) }),
      handler: async (args) => {
        const a = z
          .object({ object: z.string(), ids: z.array(z.string()).min(1).max(60) })
          .parse(args);
        await cache.ensureLoaded();
        const obj = cache.resolve(a.object);
        return withDriftHandling(a.object, async () => {
          const results = [];
          for (const id of a.ids) {
            results.push(await rest.del(`/rest/${obj.namePlural}/${id}`));
          }
          return JSON.stringify(results);
        });
      },
    },
  ];
}
