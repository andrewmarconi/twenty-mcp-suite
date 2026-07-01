import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Connection } from "./auth/types.js";
import { RestClient } from "./twenty/restClient.js";
import { GraphQLClient } from "./twenty/graphqlClient.js";
import { SchemaCache } from "./schema/cache.js";
import { schemaTools, type ToolDef } from "./tools/schemaTools.js";
import { readTools } from "./tools/readTools.js";
import { writeTools } from "./tools/writeTools.js";
import { upsertTool } from "./tools/upsertTool.js";
import type { CapabilityProfile } from "./profile/types.js";
import { buildProfileTools } from "./profile/buildProfileTools.js";
import { withAudit } from "./audit/audit.js";

export interface ServerMeta {
  name: string;
  version: string;
}

export function buildTools(
  rest: RestClient,
  gql: GraphQLClient,
  cache: SchemaCache,
): ToolDef[] {
  const tools = [
    ...schemaTools(cache),
    ...readTools(rest, cache),
    ...writeTools(rest, cache),
    upsertTool(gql, cache),
  ];
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) throw new Error(`Duplicate tool name: ${t.name}`);
    seen.add(t.name);
  }
  return tools;
}

function wireServer(
  server: McpServer,
  tools: ToolDef[],
  cache: SchemaCache,
  objectScope?: string[],
): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: unknown) => {
        const text = await tool.handler(args);
        return { content: [{ type: "text" as const, text }] };
      },
    );
  }

  const scopeSet = objectScope ? new Set(objectScope.map((s) => s.toLowerCase())) : null;
  server.registerResource(
    "schema",
    "twenty://schema",
    { description: "The live Twenty schema (objects and fields) as JSON." },
    async () => {
      await cache.ensureLoaded();
      const list = scopeSet
        ? cache
            .list()
            .filter(
              (o) =>
                scopeSet.has(o.namePlural.toLowerCase()) ||
                scopeSet.has(o.nameSingular.toLowerCase()),
            )
        : cache.list();
      return {
        contents: [
          { uri: "twenty://schema", mimeType: "application/json", text: JSON.stringify(list) },
        ],
      };
    },
  );
}

export function createServer(
  connection: Connection,
  meta: ServerMeta,
  fetchImpl: typeof fetch = fetch,
): { server: McpServer; cache: SchemaCache } {
  const rest = new RestClient(connection, fetchImpl);
  const gql = new GraphQLClient(connection, fetchImpl);
  const cache = new SchemaCache(rest);
  const server = new McpServer({ name: meta.name, version: meta.version });
  const tools = withAudit(buildTools(rest, gql, cache), {
    connection: connection.label,
    env: connection.env,
  });
  wireServer(server, tools, cache);
  return { server, cache };
}

export function createSegmentServer(
  connection: Connection,
  profile: CapabilityProfile,
  meta: ServerMeta,
  fetchImpl: typeof fetch = fetch,
): { server: McpServer; cache: SchemaCache } {
  const rest = new RestClient(connection, fetchImpl);
  const gql = new GraphQLClient(connection, fetchImpl);
  const cache = new SchemaCache(rest);
  const server = new McpServer({ name: meta.name, version: meta.version });
  const primitives = buildTools(rest, gql, cache);
  const tools = withAudit(buildProfileTools(profile, primitives, cache), {
    connection: connection.label,
    env: connection.env,
  });
  wireServer(server, tools, cache, profile.objectScope);
  return { server, cache };
}
