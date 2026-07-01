import {
  loginConnection,
  loadRegistryFile,
  FileTokenStore,
  defaultConfigDir,
  type TokenStore,
  type RegistryFile,
} from "twenty-core";
import { join } from "node:path";

export interface CliDeps {
  store: TokenStore;
  loadRegistry: () => RegistryFile | null;
  login: typeof loginConnection;
  out: (msg: string) => void;
  err: (msg: string) => void;
}

export function realDeps(env: NodeJS.ProcessEnv): CliDeps {
  const dir = defaultConfigDir(env);
  return {
    store: new FileTokenStore(dir),
    loadRegistry: () =>
      loadRegistryFile(env.TWENTY_MCP_CONFIG?.trim() ?? join(dir, "connections.json")),
    login: loginConnection,
    out: (m) => console.log(m),
    err: (m) => console.error(m),
  };
}

const USAGE =
  "usage: twenty-mcp <login <label> | connections | logout <label>>";

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
    const labels = Object.keys(registry?.connections ?? {});
    if (labels.length === 0) {
      deps.out("No connections configured.");
      return 0;
    }
    const signedIn = new Set(await deps.store.labels());
    for (const l of labels) {
      const cfg = registry!.connections[l];
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

  deps.err(USAGE);
  return 1;
}
