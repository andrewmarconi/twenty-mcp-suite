import { SERVER_NAME, SERVER_VERSION } from "./version.js";

// Full server wiring is added in Task 11. This stub keeps the build green.
async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.error(`${SERVER_NAME} ${SERVER_VERSION} starting…`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
