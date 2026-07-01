import { runCli, realDeps } from "./cli.js";

runCli(process.argv.slice(2), realDeps(process.env))
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
