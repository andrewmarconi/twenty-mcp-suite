import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveActiveConnection, createSegmentServer } from "twenty-core";
import { crmProfile } from "./profile.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

async function main(): Promise<void> {
  const connection = resolveActiveConnection(process.env);
  const { server } = createSegmentServer(connection, crmProfile, {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
