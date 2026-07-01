import {
  upsertConnection,
  removeConnection,
  setDefaultConnection,
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

async function editSite(deps: SetupDeps, reg: RegistryFile): Promise<RegistryFile> {
  const p = deps.prompts;
  const labels = Object.keys(reg.connections);
  if (labels.length === 0) {
    p.note("No connections to edit.");
    return reg;
  }
  const pick = await p.select({
    message: "Edit which connection?",
    options: labels.map((l) => ({ value: l, label: l })),
  });
  if (p.isCancel(pick)) return reg;
  const oldLabel = pick as string;
  const cur = reg.connections[oldLabel];

  const newLabel = await p.text({
    message: "Label:",
    initialValue: oldLabel,
    validate: (v) => {
      if (!v || !LABEL_RE.test(v)) return "Use only lowercase letters, digits, and hyphens.";
      if (v !== oldLabel && reg.connections[v]) return `A connection named "${v}" already exists.`;
      return undefined;
    },
  });
  if (p.isCancel(newLabel)) return reg;

  const baseUrl = await p.text({
    message: "Base URL:",
    initialValue: cur.baseUrl,
    validate: (v) => (isHttpUrl(v) ? undefined : "Enter a valid http(s) URL."),
  });
  if (p.isCancel(baseUrl)) return reg;

  const auth = await p.select<"oauth" | "apikey">({
    message: "Authentication method:",
    options: [
      { value: "oauth", label: "OAuth (browser sign-in)" },
      { value: "apikey", label: "API key (from environment)" },
    ],
    initialValue: cur.auth,
  });
  if (p.isCancel(auth)) return reg;

  const label = newLabel as string;
  const cfg: ConnectionConfig = { ...cur, baseUrl: baseUrl as string, auth: auth as "oauth" | "apikey" };

  let next = reg;
  if (label !== oldLabel) {
    next = removeConnection(next, oldLabel);
    next = upsertConnection(next, label, cfg);
    if (reg.defaultConnection === oldLabel) next = setDefaultConnection(next, label);
    if (cur.auth === "oauth") {
      p.note(`Renamed. If "${oldLabel}" was signed in, sign in again with: twenty-mcp login ${label}`);
    }
  } else {
    next = upsertConnection(next, label, cfg);
  }
  deps.saveRegistry(next);
  return next;
}

async function removeSite(deps: SetupDeps, reg: RegistryFile): Promise<RegistryFile> {
  const p = deps.prompts;
  const labels = Object.keys(reg.connections);
  if (labels.length === 0) {
    p.note("No connections to remove.");
    return reg;
  }
  const pick = await p.select({
    message: "Remove which connection?",
    options: labels.map((l) => ({ value: l, label: l })),
  });
  if (p.isCancel(pick)) return reg;
  const label = pick as string;

  const ok = await p.confirm({ message: `Remove "${label}"?` });
  if (p.isCancel(ok) || ok !== true) return reg;

  const next = removeConnection(reg, label);
  deps.saveRegistry(next);

  const stored = await deps.store.labels();
  if (stored.includes(label)) {
    const delCreds = await p.confirm({ message: "Also remove stored credentials for this site?" });
    if (!p.isCancel(delCreds) && delCreds === true) {
      await deps.store.delete(label);
    }
  }
  return next;
}

async function chooseDefault(deps: SetupDeps, reg: RegistryFile): Promise<RegistryFile> {
  const p = deps.prompts;
  const labels = Object.keys(reg.connections);
  if (labels.length === 0) {
    p.note("No connections to set as default.");
    return reg;
  }
  const pick = await p.select({
    message: "Default connection:",
    options: labels.map((l) => ({ value: l, label: l })),
    initialValue: reg.defaultConnection,
  });
  if (p.isCancel(pick)) return reg;
  const next = setDefaultConnection(reg, pick as string);
  deps.saveRegistry(next);
  return next;
}

export async function runSetup(deps: SetupDeps): Promise<number> {
  const p = deps.prompts;
  let reg: RegistryFile = deps.loadRegistry() ?? { connections: {} };

  p.intro("twenty-mcp setup");

  for (;;) {
    const action = await p.select<"add" | "edit" | "remove" | "default" | "done">({
      message: "What would you like to do?",
      options: [
        { value: "add", label: "Add a site" },
        { value: "edit", label: "Edit a site" },
        { value: "remove", label: "Remove a site" },
        { value: "default", label: "Set default connection" },
        { value: "done", label: "Done" },
      ],
    });
    if (p.isCancel(action) || action === "done") break;
    if (action === "add") reg = await addSite(deps, reg);
    else if (action === "edit") reg = await editSite(deps, reg);
    else if (action === "remove") reg = await removeSite(deps, reg);
    else if (action === "default") reg = await chooseDefault(deps, reg);
  }

  printConnections(deps, reg);
  p.outro("Setup complete.");
  return 0;
}
