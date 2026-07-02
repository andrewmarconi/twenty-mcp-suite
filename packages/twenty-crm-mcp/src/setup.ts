import {
  upsertConnection,
  removeConnection,
  setDefaultConnection,
  envKeyForLabel,
  type loginConnection,
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
  skill: {
    sourceDir: string;
    projectDest: string;
    userDest: string;
    exists(dest: string): boolean;
    install(src: string, dest: string): void;
  };
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

export type SetupCommand =
  | { kind: "interactive" }
  | { kind: "add"; label: string; url: string; auth: "oauth" | "apikey" }
  | { kind: "edit"; label: string; url?: string; auth?: "oauth" | "apikey"; newLabel?: string }
  | { kind: "remove"; label: string; purgeCredentials: boolean }
  | { kind: "set-default"; label: string }
  | { kind: "install-skill"; scope: "project" | "user" };

const ACTION_FLAGS = ["add", "edit", "remove", "set-default", "install-skill"] as const;
// action flags that carry a label value; "install-skill" is a boolean action
const VALUE_FLAGS = new Set([
  "add",
  "edit",
  "remove",
  "set-default",
  "url",
  "auth",
  "label",
  "scope",
]);
const BOOL_FLAGS = new Set(["install-skill", "purge-credentials"]);
// modifiers each action may accept (label-carrying action flags are not modifiers)
const ALLOWED_MODIFIERS: Record<(typeof ACTION_FLAGS)[number], Set<string>> = {
  add: new Set(["url", "auth"]),
  edit: new Set(["url", "auth", "label"]),
  remove: new Set(["purge-credentials"]),
  "set-default": new Set(),
  "install-skill": new Set(["scope"]),
};

export function parseSetupArgs(args: string[]): SetupCommand | { error: string } {
  if (args.length === 0) return { kind: "interactive" };

  const values = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (!tok.startsWith("--")) return { error: `Unexpected argument "${tok}".` };
    const name = tok.slice(2);
    if (BOOL_FLAGS.has(name)) {
      bools.add(name);
      continue;
    }
    if (VALUE_FLAGS.has(name)) {
      const val = args[i + 1];
      if (val === undefined || val.startsWith("--"))
        return { error: `--${name} requires a value.` };
      values.set(name, val);
      i++;
      continue;
    }
    return { error: `Unknown flag "--${name}".` };
  }

  const actions = ACTION_FLAGS.filter((a) => values.has(a) || bools.has(a));
  if (actions.length === 0) {
    return {
      error:
        "No action specified. Use one of --add, --edit, --remove, --set-default, --install-skill.",
    };
  }
  if (actions.length > 1) {
    return {
      error: `Only one action allowed per invocation; got ${actions.map((a) => `--${a}`).join(", ")}.`,
    };
  }
  const action = actions[0];

  // reject modifiers that don't belong to the chosen action
  const presentMods = [
    ...["url", "auth", "label", "scope"].filter((m) => values.has(m)),
    ...["purge-credentials"].filter((m) => bools.has(m)),
  ];
  for (const m of presentMods) {
    if (!ALLOWED_MODIFIERS[action].has(m))
      return { error: `--${m} is not valid with --${action}.` };
  }

  if (action === "add") {
    const label = values.get("add")!;
    if (!LABEL_RE.test(label))
      return { error: `Invalid label "${label}". Use lowercase letters, digits, and hyphens.` };
    const url = values.get("url");
    const auth = values.get("auth");
    if (!url || !auth) return { error: "--add requires --url and --auth." };
    if (!isHttpUrl(url)) return { error: `Invalid --url "${url}". Enter a valid http(s) URL.` };
    if (auth !== "oauth" && auth !== "apikey")
      return { error: `Invalid --auth "${auth}". Use "oauth" or "apikey".` };
    return { kind: "add", label, url, auth };
  }

  if (action === "edit") {
    const label = values.get("edit")!;
    if (!LABEL_RE.test(label))
      return { error: `Invalid label "${label}". Use lowercase letters, digits, and hyphens.` };
    const url = values.get("url");
    const auth = values.get("auth");
    const newLabel = values.get("label");
    if (url === undefined && auth === undefined && newLabel === undefined) {
      return { error: "--edit requires at least one of --url, --auth, or --label." };
    }
    if (url !== undefined && !isHttpUrl(url))
      return { error: `Invalid --url "${url}". Enter a valid http(s) URL.` };
    if (auth !== undefined && auth !== "oauth" && auth !== "apikey")
      return { error: `Invalid --auth "${auth}". Use "oauth" or "apikey".` };
    if (newLabel !== undefined && !LABEL_RE.test(newLabel))
      return {
        error: `Invalid --label "${newLabel}". Use lowercase letters, digits, and hyphens.`,
      };
    const cmd: Extract<SetupCommand, { kind: "edit" }> = { kind: "edit", label };
    if (url !== undefined) cmd.url = url;
    if (auth !== undefined) cmd.auth = auth;
    if (newLabel !== undefined) cmd.newLabel = newLabel;
    return cmd;
  }

  if (action === "remove") {
    const label = values.get("remove")!;
    if (!LABEL_RE.test(label))
      return { error: `Invalid label "${label}". Use lowercase letters, digits, and hyphens.` };
    return { kind: "remove", label, purgeCredentials: bools.has("purge-credentials") };
  }

  if (action === "set-default") {
    const label = values.get("set-default")!;
    if (!LABEL_RE.test(label))
      return { error: `Invalid label "${label}". Use lowercase letters, digits, and hyphens.` };
    return { kind: "set-default", label };
  }

  // action === "install-skill"
  const scope = values.get("scope");
  if (!scope) return { error: "--install-skill requires --scope <project|user>." };
  if (scope !== "project" && scope !== "user")
    return { error: `Invalid --scope "${scope}". Use "project" or "user".` };
  return { kind: "install-skill", scope };
}

export async function runSetupNonInteractive(cmd: SetupCommand, deps: SetupDeps): Promise<number> {
  if (cmd.kind === "interactive") return runSetup(deps); // defensive; cli.ts routes bare setup to runSetup directly
  const reg: RegistryFile = deps.loadRegistry() ?? { connections: {} };

  if (cmd.kind === "add") {
    if (reg.connections[cmd.label]) {
      deps.err(`A connection named "${cmd.label}" already exists. Use --edit to change it.`);
      return 1;
    }
    const cfg: ConnectionConfig = { baseUrl: cmd.url, auth: cmd.auth };
    const next = upsertConnection(reg, cmd.label, cfg);
    deps.saveRegistry(next);
    if (cmd.auth === "oauth") {
      deps.out(`Added "${cmd.label}". Sign in with: twenty-mcp login ${cmd.label}`);
    } else {
      deps.out(
        `Added "${cmd.label}". Set ${envKeyForLabel(cmd.label)}=<your-key> ` +
          `(or TWENTY_API_KEY) in the environment before starting the server.`,
      );
    }
    printConnections(deps, next);
    return 0;
  }

  if (cmd.kind === "edit") {
    const cur = reg.connections[cmd.label];
    if (!cur) {
      deps.err(`Unknown connection "${cmd.label}".`);
      return 1;
    }
    const cfg: ConnectionConfig = { ...cur };
    if (cmd.url !== undefined) cfg.baseUrl = cmd.url;
    if (cmd.auth !== undefined) cfg.auth = cmd.auth;

    const target = cmd.newLabel ?? cmd.label;
    let next = reg;
    if (target !== cmd.label) {
      if (reg.connections[target]) {
        deps.err(`A connection named "${target}" already exists.`);
        return 1;
      }
      next = removeConnection(next, cmd.label);
      next = upsertConnection(next, target, cfg);
      if (reg.defaultConnection === cmd.label) next = setDefaultConnection(next, target);
      if (cur.auth === "oauth") {
        deps.out(
          `Renamed. If "${cmd.label}" was signed in, sign in again with: twenty-mcp login ${target}`,
        );
      }
    } else {
      next = upsertConnection(next, target, cfg);
    }
    deps.saveRegistry(next);
    printConnections(deps, next);
    return 0;
  }

  if (cmd.kind === "remove") {
    if (!reg.connections[cmd.label]) {
      deps.err(`Unknown connection "${cmd.label}".`);
      return 1;
    }
    const next = removeConnection(reg, cmd.label);
    deps.saveRegistry(next);
    if (cmd.purgeCredentials) {
      const stored = await deps.store.labels();
      if (stored.includes(cmd.label)) await deps.store.delete(cmd.label);
    }
    printConnections(deps, next);
    return 0;
  }

  if (cmd.kind === "set-default") {
    if (!reg.connections[cmd.label]) {
      deps.err(`Unknown connection "${cmd.label}".`);
      return 1;
    }
    const next = setDefaultConnection(reg, cmd.label);
    deps.saveRegistry(next);
    printConnections(deps, next);
    return 0;
  }

  // cmd.kind === "install-skill"
  const dest = cmd.scope === "project" ? deps.skill.projectDest : deps.skill.userDest;
  deps.skill.install(deps.skill.sourceDir, dest);
  deps.out(`Installed companion skill → ${dest}`);
  return 0;
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

async function maybeOfferApiKeyStorage(deps: SetupDeps, label: string): Promise<void> {
  const p = deps.prompts;
  const existing = await deps.store.get(label);
  if (existing?.kind === "apikey") return; // a key is already stored for this label

  const choice = await p.select<"store" | "env">({
    message: "Where should the API key live?",
    options: [
      { value: "store", label: "Store it encrypted now (recommended)" },
      { value: "env", label: "Read it from the environment" },
    ],
  });
  if (!p.isCancel(choice) && choice === "store") {
    const key = await p.password({
      message: `API key for "${label}":`,
      validate: (v) => (v.trim().length > 0 ? undefined : "Enter a non-empty API key."),
    });
    if (!p.isCancel(key)) {
      await deps.store.set(label, { kind: "apikey", apiKey: (key as string).trim() });
      p.note(`API key stored (encrypted) for "${label}".`, "API key");
      return;
    }
  }
  p.note(
    `Set the API key in your environment before starting the server:\n` +
      `  ${envKeyForLabel(label)}=<your-key>\n` +
      `(or TWENTY_API_KEY as a fallback)`,
    "API key",
  );
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
    await maybeOfferApiKeyStorage(deps, label as string);
  }

  if (!deps.skill.exists(deps.skill.projectDest) && !deps.skill.exists(deps.skill.userDest)) {
    const want = await p.confirm({ message: "Install the companion skill now? (recommended)" });
    if (!p.isCancel(want) && want === true) {
      await installSkillAction(deps);
    }
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
  const cfg: ConnectionConfig = {
    ...cur,
    baseUrl: baseUrl as string,
    auth: auth as "oauth" | "apikey",
  };

  let next = reg;
  if (label !== oldLabel) {
    next = removeConnection(next, oldLabel);
    next = upsertConnection(next, label, cfg);
    if (reg.defaultConnection === oldLabel) next = setDefaultConnection(next, label);
    if (cur.auth === "oauth") {
      p.note(
        `Renamed. If "${oldLabel}" was signed in, sign in again with: twenty-mcp login ${label}`,
      );
    }
  } else {
    next = upsertConnection(next, label, cfg);
  }
  deps.saveRegistry(next);
  if (cfg.auth === "apikey") {
    await maybeOfferApiKeyStorage(deps, label);
  }
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

async function installSkillAction(deps: SetupDeps): Promise<void> {
  const p = deps.prompts;
  const scope = await p.select<"project" | "user">({
    message: "Install the companion skill where?",
    options: [
      { value: "project", label: "Project", hint: deps.skill.projectDest },
      { value: "user", label: "User", hint: deps.skill.userDest },
    ],
  });
  if (p.isCancel(scope)) return;

  const dest = scope === "project" ? deps.skill.projectDest : deps.skill.userDest;
  if (deps.skill.exists(dest)) {
    const ok = await p.confirm({
      message: `A skill already exists at ${dest}. Overwrite? This replaces any local edits.`,
    });
    if (p.isCancel(ok) || ok !== true) {
      p.note("Skipped.");
      return;
    }
  }

  deps.skill.install(deps.skill.sourceDir, dest);
  deps.out(`Installed companion skill → ${dest}`);
}

export async function runSetup(deps: SetupDeps): Promise<number> {
  const p = deps.prompts;
  let reg: RegistryFile = deps.loadRegistry() ?? { connections: {} };

  p.intro("twenty-mcp setup");

  for (;;) {
    const action = await p.select<"add" | "edit" | "remove" | "default" | "skill" | "done">({
      message: "What would you like to do?",
      options: [
        { value: "add", label: "Add a site" },
        { value: "edit", label: "Edit a site" },
        { value: "remove", label: "Remove a site" },
        { value: "default", label: "Set default connection" },
        { value: "skill", label: "Install companion skill" },
        { value: "done", label: "Done" },
      ],
    });
    if (p.isCancel(action) || action === "done") break;
    if (action === "add") reg = await addSite(deps, reg);
    else if (action === "edit") reg = await editSite(deps, reg);
    else if (action === "remove") reg = await removeSite(deps, reg);
    else if (action === "default") reg = await chooseDefault(deps, reg);
    else if (action === "skill") await installSkillAction(deps);
  }

  printConnections(deps, reg);
  p.outro("Setup complete.");
  return 0;
}
