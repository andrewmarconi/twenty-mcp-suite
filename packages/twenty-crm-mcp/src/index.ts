import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, createServer } from "twenty-core";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const { server } = createServer(config, { name: SERVER_NAME, version: SERVER_VERSION });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
