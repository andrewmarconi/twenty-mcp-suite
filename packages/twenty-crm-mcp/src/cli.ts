import {
  loginConnection,
  loadRegistryFile,
  saveRegistryFile,
  connectionsPath,
  FileTokenStore,
  defaultConfigDir,
  type TokenStore,
  type RegistryFile,
} from "twenty-core";
import {
  runSetup,
  runSetupNonInteractive,
  parseSetupArgs,
  type SetupDeps,
  type SetupCommand,
} from "./setup.js";
import { clackPrompts } from "./prompts.js";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";

export interface CliDeps {
  store: TokenStore;
  loadRegistry: () => RegistryFile | null;
  login: typeof loginConnection;
  runSetup: () => Promise<number>;
  runSetupNonInteractive: (cmd: SetupCommand) => Promise<number>;
  out: (msg: string) => void;
  err: (msg: string) => void;
}

export function realDeps(env: NodeJS.ProcessEnv): CliDeps {
  const dir = defaultConfigDir(env);
  return {
    store: new FileTokenStore(dir),
    loadRegistry: () => loadRegistryFile(connectionsPath(env)),
    login: loginConnection,
    runSetup: () => runSetup(realSetupDeps(env)),
    runSetupNonInteractive: (cmd) => runSetupNonInteractive(cmd, realSetupDeps(env)),
    out: (m) => console.log(m),
    err: (m) => console.error(m),
  };
}

export function realSetupDeps(env: NodeJS.ProcessEnv): SetupDeps {
  const dir = defaultConfigDir(env);
  const path = connectionsPath(env);
  return {
    prompts: clackPrompts(),
    loadRegistry: () => loadRegistryFile(path),
    saveRegistry: (reg) => saveRegistryFile(path, reg),
    store: new FileTokenStore(dir),
    login: loginConnection,
    skill: {
      sourceDir: fileURLToPath(new URL("../skill/twenty-crm", import.meta.url)),
      projectDest: join(process.cwd(), ".claude", "skills", "twenty-crm"),
      userDest: join(homedir(), ".claude", "skills", "twenty-crm"),
      exists: (dest) => existsSync(dest),
      install: (src, dest) => {
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(src, dest, { recursive: true });
      },
    },
    out: (m) => console.log(m),
    err: (m) => console.error(m),
  };
}

const USAGE =
  "usage: twenty-mcp <\n" +
  "  setup                                             interactive TUI\n" +
  "  setup --add <label> --url <url> --auth <oauth|apikey>\n" +
  "  setup --edit <label> [--url <url>] [--auth <mode>] [--label <new>]\n" +
  "  setup --remove <label> [--purge-credentials]\n" +
  "  setup --set-default <label>\n" +
  "  setup --install-skill --scope <project|user>\n" +
  "  login <label> | connections | logout <label>\n" +
  ">";

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [cmd, label] = argv;

  if (cmd === "login") {
    if (!label) {
      deps.err(USAGE);
      return 1;
    }
    const registry = deps.loadRegistry();
    const cfg = registry?.connections[label];
    if (!cfg) {
      deps.err(`Unknown connection "${label}". Add it to your connections registry first.`);
      return 1;
    }
    await deps.login({ label, baseUrl: cfg.baseUrl, store: deps.store });
    return 0;
  }

  if (cmd === "connections") {
    const registry = deps.loadRegistry();
    const conns = registry?.connections ?? {};
    const labels = Object.keys(conns);
    if (labels.length === 0) {
      deps.out("No connections configured.");
      return 0;
    }
    const signedIn = new Set(await deps.store.labels());
    for (const l of labels) {
      const cfg = conns[l];
      const state = cfg.auth === "oauth" ? (signedIn.has(l) ? "signed in" : "not signed in") : "api key";
      deps.out(`${l}  (${cfg.auth}, ${cfg.baseUrl})  — ${state}`);
    }
    return 0;
  }

  if (cmd === "logout") {
    if (!label) {
      deps.err(USAGE);
      return 1;
    }
    await deps.store.delete(label);
    deps.out(`Logged out of "${label}".`);
    return 0;
  }

  if (cmd === "setup") {
    const parsed = parseSetupArgs(argv.slice(1));
    if ("error" in parsed) {
      deps.err(parsed.error);
      return 1;
    }
    if (parsed.kind === "interactive") return deps.runSetup();
    return deps.runSetupNonInteractive(parsed);
  }

  deps.err(USAGE);
  return 1;
}
