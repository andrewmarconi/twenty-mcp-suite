import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TwentyConfig } from "./config.js";
import { RestClient } from "./twenty/restClient.js";
import { GraphQLClient } from "./twenty/graphqlClient.js";
import { SchemaCache } from "./schema/cache.js";
import { schemaTools, type ToolDef } from "./tools/schemaTools.js";
import { readTools } from "./tools/readTools.js";
import { writeTools } from "./tools/writeTools.js";
import { upsertTool } from "./tools/upsertTool.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

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

export function createServer(
  config: TwentyConfig,
  fetchImpl: typeof fetch = fetch,
): { server: McpServer; cache: SchemaCache } {
  const rest = new RestClient(config, fetchImpl);
  const gql = new GraphQLClient(config, fetchImpl);
  const cache = new SchemaCache(rest);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const tool of buildTools(rest, gql, cache)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: unknown) => {
        const text = await tool.handler(args);
        return { content: [{ type: "text" as const, text }] };
      },
    );
  }

  server.registerResource(
    "schema",
    "twenty://schema",
    { description: "The live Twenty schema (objects and fields) as JSON." },
    async () => {
      await cache.ensureLoaded();
      return {
        contents: [
          {
            uri: "twenty://schema",
            mimeType: "application/json",
            text: JSON.stringify(cache.list()),
          },
        ],
      };
    },
  );

  return { server, cache };
}
