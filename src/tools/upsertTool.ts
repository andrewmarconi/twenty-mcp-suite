import { z } from "zod";
import type { GraphQLClient } from "../twenty/graphqlClient.js";
import type { SchemaCache } from "../schema/cache.js";
import type { ToolDef } from "./schemaTools.js";
import { withDriftHandling } from "./helpers.js";

export function upsertMutationName(namePlural: string): string {
  return "create" + namePlural.charAt(0).toUpperCase() + namePlural.slice(1);
}

const shape = z.object({
  object: z.string(),
  records: z.array(z.record(z.string(), z.unknown())).min(1).max(60),
});

export function upsertTool(gql: GraphQLClient, cache: SchemaCache): ToolDef {
  return {
    name: "upsert_records",
    description:
      "Create-or-update 1–60 records of one object in a single call. Records with an existing id (or unique field match) are updated; others are created.",
    inputSchema: shape,
    handler: async (args) => {
      const a = shape.parse(args);
      await cache.ensureLoaded();
      const obj = cache.resolve(a.object);
      const mutationName = upsertMutationName(obj.namePlural);
      const query = `mutation Upsert($data: [${obj.labelSingular.replace(/\s+/g, "")}CreateInput!]!) {
  ${mutationName}(data: $data, upsert: true) { id }
}`;
      return withDriftHandling(a.object, async () => {
        const data = await gql.request(query, { data: a.records });
        return JSON.stringify((data as Record<string, unknown>)[mutationName]);
      });
    },
  };
}
