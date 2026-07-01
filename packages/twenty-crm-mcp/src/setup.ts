import {
  upsertConnection,
  envKeyForLabel,
  loginConnection,
  type RegistryFile,
  type ConnectionConfig,
  type TokenStore,
} from "twenty-core";
import type { PromptAPI } from "./prompts.js";

export interface SetupDeps {
  prompts: PromptAPI;
  loadRegistry(): RegistryFile | null;
  saveRegistry(reg: RegistryFile): void;
  store: TokenStore;
  login: typeof loginConnection;
  out(msg: string): void;
  err(msg: string): void;
}

const LABEL_RE = /^[a-z0-9-]+$/;

export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function printConnections(deps: SetupDeps, reg: RegistryFile): void {
  const labels = Object.keys(reg.connections);
  if (labels.length === 0) {
    deps.out("No connections configured.");
    return;
  }
  deps.out("Connections:");
  for (const l of labels) {
    const c = reg.connections[l];
    const def = reg.defaultConnection === l ? "  [default]" : "";
    deps.out(`  ${l}  (${c.auth}, ${c.baseUrl})${def}`);
  }
}

async function addSite(deps: SetupDeps, reg: RegistryFile): Promise<RegistryFile> {
  const p = deps.prompts;

  const label = await p.text({
    message: "Connection label (lowercase letters, digits, hyphens):",
    validate: (v) => {
      if (!v || !LABEL_RE.test(v)) return "Use only lowercase letters, digits, and hyphens.";
      if (reg.connections[v]) return `A connection named "${v}" already exists.`;
      return undefined;
    },
  });
  if (p.isCancel(label)) return reg;

  const baseUrl = await p.text({
    message: "Base URL (e.g. https://crm.example.com):",
    validate: (v) => (isHttpUrl(v) ? undefined : "Enter a valid http(s) URL."),
  });
  if (p.isCancel(baseUrl)) return reg;

  const auth = await p.select<"oauth" | "apikey">({
    message: "Authentication method:",
    options: [
      { value: "oauth", label: "OAuth (browser sign-in)" },
      { value: "apikey", label: "API key (from environment)" },
    ],
  });
  if (p.isCancel(auth)) return reg;

  const cfg: ConnectionConfig = { baseUrl: baseUrl as string, auth: auth as "oauth" | "apikey" };
  const next = upsertConnection(reg, label as string, cfg);
  deps.saveRegistry(next);

  if (auth === "oauth") {
    const now = await p.confirm({ message: "Sign in now?" });
    if (!p.isCancel(now) && now === true) {
      try {
        await deps.login({ label: label as string, baseUrl: baseUrl as string, store: deps.store });
      } catch (e) {
        deps.err(
          `Sign-in failed: ${e instanceof Error ? e.message : String(e)}. ` +
            `You can retry later with: twenty-mcp login ${label as string}`,
        );
      }
    }
  } else {
    p.note(
      `Set the API key in your environment before starting the server:\n` +
        `  ${envKeyForLabel(label as string)}=<your-key>\n` +
        `(or TWENTY_API_KEY as a fallback)`,
      "API key",
    );
  }
  return next;
}

export async function runSetup(deps: SetupDeps): Promise<number> {
  const p = deps.prompts;
  let reg: RegistryFile = deps.loadRegistry() ?? { connections: {} };

  p.intro("twenty-mcp setup");

  for (;;) {
    const action = await p.select<"add" | "done">({
      message: "What would you like to do?",
      options: [
        { value: "add", label: "Add a site" },
        { value: "done", label: "Done" },
      ],
    });
    if (p.isCancel(action) || action === "done") break;
    if (action === "add") reg = await addSite(deps, reg);
  }

  printConnections(deps, reg);
  p.outro("Setup complete.");
  return 0;
}
