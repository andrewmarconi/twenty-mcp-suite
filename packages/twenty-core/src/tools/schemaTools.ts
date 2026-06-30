import { z } from "zod";
import type { SchemaCache } from "../schema/cache.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<string>;
}

export function schemaTools(cache: SchemaCache): ToolDef[] {
  return [
    {
      name: "list_object_types",
      description:
        "List all available Twenty objects (built-in and custom). Use this first to discover what you can query.",
      inputSchema: z.object({}),
      handler: async () => {
        await cache.ensureLoaded();
        const list = cache.list().map((o) => ({
          nameSingular: o.nameSingular,
          namePlural: o.namePlural,
          labelPlural: o.labelPlural,
          isSystem: o.isSystem,
        }));
        return JSON.stringify(list);
      },
    },
    {
      name: "describe_object",
      description:
        "Return the fields, types, and metadata for one object. Call this before writing records so you use real field names.",
      inputSchema: z.object({ object: z.string() }),
      handler: async (args) => {
        const { object } = z.object({ object: z.string() }).parse(args);
        await cache.ensureLoaded();
        return JSON.stringify(cache.resolve(object));
      },
    },
    {
      name: "refresh_schema",
      description:
        "Reload the live Twenty schema. Call this after adding/changing objects or fields, or when a tool reports a schema mismatch.",
      inputSchema: z.object({}),
      handler: async () => {
        const objectCount = await cache.refresh();
        return JSON.stringify({ refreshed: true, objectCount });
      },
    },
  ];
}
