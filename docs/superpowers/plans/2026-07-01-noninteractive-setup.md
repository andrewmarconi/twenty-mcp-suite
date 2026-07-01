# Non-interactive (flag-driven) `twenty-mcp setup` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a flag-driven, non-interactive mode to `twenty-mcp setup` (add / edit / remove / set-default / install-skill) so connections can be managed in scripts and CI without the TUI.

**Architecture:** Two new exports in `packages/twenty-crm-mcp/src/setup.ts` — a pure `parseSetupArgs` (argv → discriminated `SetupCommand` union, or `{error}`) and `runSetupNonInteractive` (executes a command against the existing `SetupDeps`, reusing the `twenty-core` mutators and the module's `isHttpUrl` / `LABEL_RE` / `envKeyForLabel` / `printConnections` helpers). `src/cli.ts` parses `setup`'s remaining argv and dispatches to the interactive `runSetup` (bare) or the non-interactive runner (any action flag). No `twenty-core` change.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), pnpm workspaces, vitest, dependency-injected fakes (no network in tests).

## Global Constraints

- Node **>= 22**; package manager is **pnpm**, not npm.
- **ESM with `.js` import extensions** on local imports; cross-package imports use the bare name `twenty-core`.
- **stdout is reserved for the MCP protocol** in the server — but the CLI is a standalone process and may use stdout freely (`deps.out` → `console.log`, `deps.err` → `console.error`).
- **No secret is ever written to `connections.json`** — oauth-add records the site only and prints a `login` hint.
- **Tests inject fakes, never hit the network.** Mirror the existing `setup.test.ts` / `cli.test.ts` DI style.
- Run one package's suite with `pnpm --filter twenty-crm-mcp test`.
- Exactly **one action per invocation**; two action flags is a parse error.

---

### Task 1: `parseSetupArgs` — pure argv parser

**Files:**
- Modify: `packages/twenty-crm-mcp/src/setup.ts` (add `SetupCommand` type + `parseSetupArgs` export; the module already exports `isHttpUrl` and has module-local `LABEL_RE`)
- Test: `packages/twenty-crm-mcp/src/setup-noninteractive.test.ts` (new)

**Interfaces:**
- Consumes: module-local `LABEL_RE` (`/^[a-z0-9-]+$/`) and exported `isHttpUrl(v: string): boolean`, both already in `setup.ts`.
- Produces:
  ```ts
  export type SetupCommand =
    | { kind: "interactive" }
    | { kind: "add"; label: string; url: string; auth: "oauth" | "apikey" }
    | { kind: "edit"; label: string; url?: string; auth?: "oauth" | "apikey"; newLabel?: string }
    | { kind: "remove"; label: string; purgeCredentials: boolean }
    | { kind: "set-default"; label: string }
    | { kind: "install-skill"; scope: "project" | "user" };

  export function parseSetupArgs(args: string[]): SetupCommand | { error: string };
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/twenty-crm-mcp/src/setup-noninteractive.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSetupArgs } from "./setup.js";

describe("parseSetupArgs", () => {
  it("no args → interactive", () => {
    expect(parseSetupArgs([])).toEqual({ kind: "interactive" });
  });

  it("parses --add with --url and --auth", () => {
    expect(parseSetupArgs(["--add", "acme", "--url", "https://crm.acme.com", "--auth", "apikey"]))
      .toEqual({ kind: "add", label: "acme", url: "https://crm.acme.com", auth: "apikey" });
  });

  it("--add without --url or --auth is an error", () => {
    expect(parseSetupArgs(["--add", "acme", "--url", "https://crm.acme.com"]))
      .toEqual({ error: expect.stringMatching(/--auth/) });
  });

  it("--add with a bad url is an error", () => {
    expect(parseSetupArgs(["--add", "acme", "--url", "not-a-url", "--auth", "apikey"]))
      .toEqual({ error: expect.stringMatching(/url/i) });
  });

  it("--add with a bad auth is an error", () => {
    expect(parseSetupArgs(["--add", "acme", "--url", "https://x.io", "--auth", "basic"]))
      .toEqual({ error: expect.stringMatching(/auth/i) });
  });

  it("--add with a bad label is an error", () => {
    expect(parseSetupArgs(["--add", "Acme!", "--url", "https://x.io", "--auth", "apikey"]))
      .toEqual({ error: expect.stringMatching(/label/i) });
  });

  it("parses --edit with only the fields provided", () => {
    expect(parseSetupArgs(["--edit", "acme", "--url", "https://new.io"]))
      .toEqual({ kind: "edit", label: "acme", url: "https://new.io" });
  });

  it("parses --edit --label as a rename", () => {
    expect(parseSetupArgs(["--edit", "acme", "--label", "acme-prod"]))
      .toEqual({ kind: "edit", label: "acme", newLabel: "acme-prod" });
  });

  it("--edit with no modifiers is an error", () => {
    expect(parseSetupArgs(["--edit", "acme"]))
      .toEqual({ error: expect.stringMatching(/--url|--auth|--label/) });
  });

  it("parses --remove with --purge-credentials", () => {
    expect(parseSetupArgs(["--remove", "acme", "--purge-credentials"]))
      .toEqual({ kind: "remove", label: "acme", purgeCredentials: true });
  });

  it("parses --remove without purge as purgeCredentials:false", () => {
    expect(parseSetupArgs(["--remove", "acme"]))
      .toEqual({ kind: "remove", label: "acme", purgeCredentials: false });
  });

  it("parses --set-default", () => {
    expect(parseSetupArgs(["--set-default", "acme"]))
      .toEqual({ kind: "set-default", label: "acme" });
  });

  it("parses --install-skill --scope", () => {
    expect(parseSetupArgs(["--install-skill", "--scope", "user"]))
      .toEqual({ kind: "install-skill", scope: "user" });
  });

  it("--install-skill without --scope is an error", () => {
    expect(parseSetupArgs(["--install-skill"]))
      .toEqual({ error: expect.stringMatching(/--scope/) });
  });

  it("--install-skill with a bad scope is an error", () => {
    expect(parseSetupArgs(["--install-skill", "--scope", "global"]))
      .toEqual({ error: expect.stringMatching(/scope/i) });
  });

  it("two action flags is an error", () => {
    expect(parseSetupArgs(["--add", "acme", "--url", "https://x.io", "--auth", "apikey", "--set-default", "acme"]))
      .toEqual({ error: expect.stringMatching(/one action/i) });
  });

  it("an action modifier that does not belong to the action is an error", () => {
    expect(parseSetupArgs(["--set-default", "acme", "--url", "https://x.io"]))
      .toEqual({ error: expect.stringMatching(/--url/) });
  });

  it("an unknown flag is an error", () => {
    expect(parseSetupArgs(["--frob", "x"]))
      .toEqual({ error: expect.stringMatching(/--frob/) });
  });

  it("a value flag with no value is an error", () => {
    expect(parseSetupArgs(["--add"]))
      .toEqual({ error: expect.stringMatching(/--add/) });
  });

  it("a bare positional argument is an error", () => {
    expect(parseSetupArgs(["acme"]))
      .toEqual({ error: expect.stringMatching(/acme/) });
  });

  it("modifiers present but no action is an error", () => {
    expect(parseSetupArgs(["--url", "https://x.io"]))
      .toEqual({ error: expect.stringMatching(/action/i) });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter twenty-crm-mcp test setup-noninteractive`
Expected: FAIL — `parseSetupArgs is not a function` (export does not exist yet).

- [ ] **Step 3: Implement `parseSetupArgs`**

In `packages/twenty-crm-mcp/src/setup.ts`, after the existing `isHttpUrl` function (around line 39), add:

```ts
export type SetupCommand =
  | { kind: "interactive" }
  | { kind: "add"; label: string; url: string; auth: "oauth" | "apikey" }
  | { kind: "edit"; label: string; url?: string; auth?: "oauth" | "apikey"; newLabel?: string }
  | { kind: "remove"; label: string; purgeCredentials: boolean }
  | { kind: "set-default"; label: string }
  | { kind: "install-skill"; scope: "project" | "user" };

const ACTION_FLAGS = ["add", "edit", "remove", "set-default", "install-skill"] as const;
// action flags that carry a label value; "install-skill" is a boolean action
const VALUE_FLAGS = new Set(["add", "edit", "remove", "set-default", "url", "auth", "label", "scope"]);
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
      if (val === undefined || val.startsWith("--")) return { error: `--${name} requires a value.` };
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
    return { error: `Only one action allowed per invocation; got ${actions.map((a) => "--" + a).join(", ")}.` };
  }
  const action = actions[0];

  // reject modifiers that don't belong to the chosen action
  const presentMods = [
    ...["url", "auth", "label", "scope"].filter((m) => values.has(m)),
    ...["purge-credentials"].filter((m) => bools.has(m)),
  ];
  for (const m of presentMods) {
    if (!ALLOWED_MODIFIERS[action].has(m)) return { error: `--${m} is not valid with --${action}.` };
  }

  if (action === "add") {
    const label = values.get("add")!;
    if (!LABEL_RE.test(label)) return { error: `Invalid label "${label}". Use lowercase letters, digits, and hyphens.` };
    const url = values.get("url");
    const auth = values.get("auth");
    if (!url || !auth) return { error: "--add requires --url and --auth." };
    if (!isHttpUrl(url)) return { error: `Invalid --url "${url}". Enter a valid http(s) URL.` };
    if (auth !== "oauth" && auth !== "apikey") return { error: `Invalid --auth "${auth}". Use "oauth" or "apikey".` };
    return { kind: "add", label, url, auth };
  }

  if (action === "edit") {
    const label = values.get("edit")!;
    if (!LABEL_RE.test(label)) return { error: `Invalid label "${label}". Use lowercase letters, digits, and hyphens.` };
    const url = values.get("url");
    const auth = values.get("auth");
    const newLabel = values.get("label");
    if (url === undefined && auth === undefined && newLabel === undefined) {
      return { error: "--edit requires at least one of --url, --auth, or --label." };
    }
    if (url !== undefined && !isHttpUrl(url)) return { error: `Invalid --url "${url}". Enter a valid http(s) URL.` };
    if (auth !== undefined && auth !== "oauth" && auth !== "apikey") return { error: `Invalid --auth "${auth}". Use "oauth" or "apikey".` };
    if (newLabel !== undefined && !LABEL_RE.test(newLabel)) return { error: `Invalid --label "${newLabel}". Use lowercase letters, digits, and hyphens.` };
    const cmd: Extract<SetupCommand, { kind: "edit" }> = { kind: "edit", label };
    if (url !== undefined) cmd.url = url;
    if (auth !== undefined) cmd.auth = auth;
    if (newLabel !== undefined) cmd.newLabel = newLabel;
    return cmd;
  }

  if (action === "remove") {
    const label = values.get("remove")!;
    if (!LABEL_RE.test(label)) return { error: `Invalid label "${label}". Use lowercase letters, digits, and hyphens.` };
    return { kind: "remove", label, purgeCredentials: bools.has("purge-credentials") };
  }

  if (action === "set-default") {
    const label = values.get("set-default")!;
    if (!LABEL_RE.test(label)) return { error: `Invalid label "${label}". Use lowercase letters, digits, and hyphens.` };
    return { kind: "set-default", label };
  }

  // action === "install-skill"
  const scope = values.get("scope");
  if (!scope) return { error: "--install-skill requires --scope <project|user>." };
  if (scope !== "project" && scope !== "user") return { error: `Invalid --scope "${scope}". Use "project" or "user".` };
  return { kind: "install-skill", scope };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter twenty-crm-mcp test setup-noninteractive`
Expected: PASS (all `parseSetupArgs` cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/twenty-crm-mcp/src/setup.ts packages/twenty-crm-mcp/src/setup-noninteractive.test.ts
git commit -m "feat(setup): parse non-interactive setup flags (#15)"
```

---

### Task 2: `runSetupNonInteractive` — execute a parsed command

**Files:**
- Modify: `packages/twenty-crm-mcp/src/setup.ts` (add `runSetupNonInteractive` export)
- Test: `packages/twenty-crm-mcp/src/setup-noninteractive.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `SetupCommand` (Task 1); the existing `SetupDeps` interface; the `twenty-core` mutators already imported in `setup.ts` (`upsertConnection`, `removeConnection`, `setDefaultConnection`, `envKeyForLabel`); the module's `printConnections`.
- Produces:
  ```ts
  export async function runSetupNonInteractive(cmd: SetupCommand, deps: SetupDeps): Promise<number>;
  ```
  Returns `0` on success, `1` on a runtime error (add-existing, or edit/remove/set-default of a missing label). The `deps.prompts` field is unused by this function.

- [ ] **Step 1: Write the failing tests**

Append to `packages/twenty-crm-mcp/src/setup-noninteractive.test.ts`:

```ts
import { vi } from "vitest";
import { runSetupNonInteractive } from "./setup.js";
import type { RegistryFile } from "twenty-core";

function ndeps(over: Record<string, unknown> = {}) {
  const saved: RegistryFile[] = [];
  const d = {
    prompts: {} as never,
    loadRegistry: () => ({ connections: {} }) as RegistryFile,
    saveRegistry: (reg: RegistryFile) => { saved.push(reg); },
    store: { get: vi.fn(), set: vi.fn(), delete: vi.fn().mockResolvedValue(undefined), labels: vi.fn().mockResolvedValue([]) },
    login: vi.fn().mockResolvedValue(undefined),
    skill: {
      sourceDir: "/pkg/skill/twenty-crm",
      projectDest: "/proj/.claude/skills/twenty-crm",
      userDest: "/home/.claude/skills/twenty-crm",
      exists: () => false,
      install: vi.fn(),
    },
    out: vi.fn(),
    err: vi.fn(),
    ...over,
  };
  return { saved, d };
}

const seeded = (): RegistryFile => ({
  defaultConnection: "acme",
  connections: {
    acme: { baseUrl: "https://crm.acme.com", auth: "oauth" },
    sandbox: { baseUrl: "https://dev.acme.com", auth: "apikey" },
  },
});

describe("runSetupNonInteractive — add", () => {
  it("adds an apikey site, prints the env-var hint, and does not call login", async () => {
    const { saved, d } = ndeps();
    const code = await runSetupNonInteractive({ kind: "add", label: "acme", url: "https://crm.acme.com", auth: "apikey" }, d as never);
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.acme).toEqual({ baseUrl: "https://crm.acme.com", auth: "apikey" });
    expect(d.out).toHaveBeenCalledWith(expect.stringMatching(/TWENTY_API_KEY_ACME/));
    expect(d.login).not.toHaveBeenCalled();
  });

  it("adds an oauth site, prints the login hint, and does not call login", async () => {
    const { saved, d } = ndeps();
    const code = await runSetupNonInteractive({ kind: "add", label: "acme", url: "https://crm.acme.com", auth: "oauth" }, d as never);
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.acme.auth).toBe("oauth");
    expect(d.out).toHaveBeenCalledWith(expect.stringMatching(/twenty-mcp login acme/));
    expect(d.login).not.toHaveBeenCalled();
  });

  it("errors (exit 1) and writes nothing when the label already exists", async () => {
    const { saved, d } = ndeps({ loadRegistry: () => seeded() });
    const code = await runSetupNonInteractive({ kind: "add", label: "acme", url: "https://x.io", auth: "apikey" }, d as never);
    expect(code).toBe(1);
    expect(saved).toHaveLength(0);
    expect(d.err).toHaveBeenCalledWith(expect.stringMatching(/already exists/));
  });
});

describe("runSetupNonInteractive — edit", () => {
  it("changes only the provided field", async () => {
    const { saved, d } = ndeps({ loadRegistry: () => seeded() });
    const code = await runSetupNonInteractive({ kind: "edit", label: "acme", url: "https://new.acme.com" }, d as never);
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.acme.baseUrl).toBe("https://new.acme.com");
    expect(saved.at(-1)!.connections.acme.auth).toBe("oauth"); // unchanged
  });

  it("renames a site and moves the default with it", async () => {
    const { saved, d } = ndeps({ loadRegistry: () => seeded() });
    await runSetupNonInteractive({ kind: "edit", label: "acme", newLabel: "acme-prod" }, d as never);
    const last = saved.at(-1)!;
    expect(last.connections.acme).toBeUndefined();
    expect(last.connections["acme-prod"]).toBeDefined();
    expect(last.defaultConnection).toBe("acme-prod");
    expect(d.out).toHaveBeenCalledWith(expect.stringMatching(/twenty-mcp login acme-prod/));
  });

  it("errors when the label is unknown", async () => {
    const { saved, d } = ndeps({ loadRegistry: () => seeded() });
    const code = await runSetupNonInteractive({ kind: "edit", label: "nope", url: "https://x.io" }, d as never);
    expect(code).toBe(1);
    expect(saved).toHaveLength(0);
  });
});

describe("runSetupNonInteractive — remove", () => {
  it("removes the entry and purges credentials when asked and a token exists", async () => {
    const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn().mockResolvedValue(undefined), labels: vi.fn().mockResolvedValue(["acme"]) };
    const { saved, d } = ndeps({ loadRegistry: () => seeded(), store });
    const code = await runSetupNonInteractive({ kind: "remove", label: "acme", purgeCredentials: true }, d as never);
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.acme).toBeUndefined();
    expect(store.delete).toHaveBeenCalledWith("acme");
  });

  it("does not purge credentials without the flag", async () => {
    const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn().mockResolvedValue(undefined), labels: vi.fn().mockResolvedValue(["acme"]) };
    const { d } = ndeps({ loadRegistry: () => seeded(), store });
    await runSetupNonInteractive({ kind: "remove", label: "acme", purgeCredentials: false }, d as never);
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("errors when the label is unknown", async () => {
    const { saved, d } = ndeps({ loadRegistry: () => seeded() });
    const code = await runSetupNonInteractive({ kind: "remove", label: "nope", purgeCredentials: false }, d as never);
    expect(code).toBe(1);
    expect(saved).toHaveLength(0);
  });
});

describe("runSetupNonInteractive — set-default & install-skill", () => {
  it("sets the default connection", async () => {
    const { saved, d } = ndeps({ loadRegistry: () => seeded() });
    const code = await runSetupNonInteractive({ kind: "set-default", label: "sandbox" }, d as never);
    expect(code).toBe(0);
    expect(saved.at(-1)!.defaultConnection).toBe("sandbox");
  });

  it("errors on set-default of an unknown label", async () => {
    const { saved, d } = ndeps({ loadRegistry: () => seeded() });
    const code = await runSetupNonInteractive({ kind: "set-default", label: "nope" }, d as never);
    expect(code).toBe(1);
    expect(saved).toHaveLength(0);
  });

  it("installs the skill to the chosen scope, overwriting silently", async () => {
    const { d } = ndeps();
    const code = await runSetupNonInteractive({ kind: "install-skill", scope: "project" }, d as never);
    expect(code).toBe(0);
    expect(d.skill.install).toHaveBeenCalledWith("/pkg/skill/twenty-crm", "/proj/.claude/skills/twenty-crm");
    expect(d.out).toHaveBeenCalledWith(expect.stringMatching(/Installed companion skill/));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter twenty-crm-mcp test setup-noninteractive`
Expected: FAIL — `runSetupNonInteractive is not a function`.

- [ ] **Step 3: Implement `runSetupNonInteractive`**

In `packages/twenty-crm-mcp/src/setup.ts`, add after `parseSetupArgs`:

```ts
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
        deps.out(`Renamed. If "${cmd.label}" was signed in, sign in again with: twenty-mcp login ${target}`);
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter twenty-crm-mcp test setup-noninteractive`
Expected: PASS (parser + runner blocks all green).

- [ ] **Step 5: Commit**

```bash
git add packages/twenty-crm-mcp/src/setup.ts packages/twenty-crm-mcp/src/setup-noninteractive.test.ts
git commit -m "feat(setup): execute non-interactive setup commands (#15)"
```

---

### Task 3: CLI wiring — dispatch `setup` flags

**Files:**
- Modify: `packages/twenty-crm-mcp/src/cli.ts` (extend `CliDeps`, wire `realDeps`, rewrite the `setup` branch, extend `USAGE`)
- Test: `packages/twenty-crm-mcp/src/cli.test.ts` (add cases; extend the `deps()` fake)

**Interfaces:**
- Consumes: `parseSetupArgs`, `runSetupNonInteractive`, and `SetupCommand` from `./setup.js` (Task 1 & 2); existing `realSetupDeps(env)`.
- Produces: `CliDeps` gains `runSetupNonInteractive: (cmd: SetupCommand) => Promise<number>`.

- [ ] **Step 1: Write the failing tests**

In `packages/twenty-crm-mcp/src/cli.test.ts`, add `runSetupNonInteractive` to the `deps()` fake (inside the returned object, alongside `runSetup`):

```ts
    runSetup: vi.fn().mockResolvedValue(0),
    runSetupNonInteractive: vi.fn().mockResolvedValue(0),
```

Then add these cases inside `describe("runCli", ...)`:

```ts
  it("bare setup delegates to the interactive runSetup", async () => {
    const d = deps();
    const code = await runCli(["setup"], d as never);
    expect(code).toBe(0);
    expect(d.runSetup).toHaveBeenCalled();
    expect(d.runSetupNonInteractive).not.toHaveBeenCalled();
  });

  it("setup with an action flag delegates to runSetupNonInteractive with the parsed command", async () => {
    const d = deps();
    const code = await runCli(
      ["setup", "--add", "acme", "--url", "https://crm.acme.com", "--auth", "apikey"],
      d as never,
    );
    expect(code).toBe(0);
    expect(d.runSetupNonInteractive).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "add", label: "acme", url: "https://crm.acme.com", auth: "apikey" }),
    );
    expect(d.runSetup).not.toHaveBeenCalled();
  });

  it("setup with a bad flag returns 1 and reports the error", async () => {
    const d = deps();
    const code = await runCli(["setup", "--add", "acme", "--url", "not-a-url", "--auth", "apikey"], d as never);
    expect(code).toBe(1);
    expect(d.err).toHaveBeenCalledWith(expect.stringMatching(/url/i));
    expect(d.runSetup).not.toHaveBeenCalled();
    expect(d.runSetupNonInteractive).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter twenty-crm-mcp test cli`
Expected: FAIL — the `setup` branch still calls `deps.runSetup()` unconditionally, so the action-flag case calls `runSetup` (not `runSetupNonInteractive`) and the bad-flag case does not return 1.

- [ ] **Step 3: Wire the CLI**

In `packages/twenty-crm-mcp/src/cli.ts`:

1. Extend the import from `./setup.js` (currently `import { runSetup, type SetupDeps } from "./setup.js";`):

```ts
import {
  runSetup,
  runSetupNonInteractive,
  parseSetupArgs,
  type SetupDeps,
  type SetupCommand,
} from "./setup.js";
```

2. Add to the `CliDeps` interface (after `runSetup: () => Promise<number>;`):

```ts
  runSetupNonInteractive: (cmd: SetupCommand) => Promise<number>;
```

3. In `realDeps`, wire it (after the `runSetup:` line):

```ts
    runSetupNonInteractive: (cmd) => runSetupNonInteractive(cmd, realSetupDeps(env)),
```

4. Replace the `setup` branch (currently `if (cmd === "setup") { return deps.runSetup(); }`) with:

```ts
  if (cmd === "setup") {
    const parsed = parseSetupArgs(argv.slice(1));
    if ("error" in parsed) {
      deps.err(parsed.error);
      return 1;
    }
    if (parsed.kind === "interactive") return deps.runSetup();
    return deps.runSetupNonInteractive(parsed);
  }
```

5. Extend `USAGE` to document the non-interactive form:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter twenty-crm-mcp test cli`
Expected: PASS. The existing `"setup delegates to runSetup and returns its code"` test still passes (bare `setup` → `runSetup`).

- [ ] **Step 5: Full build + suite**

Run: `pnpm --filter twenty-crm-mcp test && pnpm --filter twenty-crm-mcp build`
Expected: all tests PASS; tsup build succeeds (no TS errors — confirms `CliDeps`, `SetupCommand`, and the discriminated-union narrowing all typecheck).

- [ ] **Step 6: Commit**

```bash
git add packages/twenty-crm-mcp/src/cli.ts packages/twenty-crm-mcp/src/cli.test.ts
git commit -m "feat(setup): dispatch non-interactive setup from the CLI (#15)"
```

---

### Task 4: Documentation

**Files:**
- Modify: `packages/twenty-crm-mcp/README.md` (the CLI / setup section — locate the existing `twenty-mcp setup` docs)
- Modify: `apps/docs` setup/CLI page if one documents `setup` (grep for `twenty-mcp setup`)

**Interfaces:** none (docs only).

- [ ] **Step 1: Find where `setup` is documented**

Run: `grep -rn "twenty-mcp setup" packages/twenty-crm-mcp/README.md apps/docs`
Expected: one or more locations describing the interactive `setup` command.

- [ ] **Step 2: Add the non-interactive reference**

Under the existing `setup` documentation, add a "Non-interactive (scripting / CI)" subsection listing each form (copy the `USAGE` block above), and note:
- oauth-add records the site only; run `twenty-mcp login <label>` separately (no browser flow in CI).
- apikey-add prints the `TWENTY_API_KEY_<LABEL>` env var to set.
- `--install-skill` overwrites an existing skill without prompting.
- one action per invocation.

Match the surrounding README's heading depth and prose style. Do not hard-wrap prose lines mid-sentence beyond the file's existing convention.

- [ ] **Step 3: Verify docs build (if the docs app references it)**

Run: `pnpm docs:build`
Expected: build succeeds. (Skip if `apps/docs` was not modified.)

- [ ] **Step 4: Commit**

```bash
git add packages/twenty-crm-mcp/README.md apps/docs
git commit -m "docs(setup): document non-interactive setup flags (#15)"
```

---

## Notes for the implementer

- **Where new code goes:** `parseSetupArgs` and `runSetupNonInteractive` are added to the **existing** `setup.ts`, below `isHttpUrl` and above (or below) the existing `runSetup`. They reuse `LABEL_RE`, `isHttpUrl`, `printConnections`, `envKeyForLabel`, and the `twenty-core` mutators already imported at the top of the file — do not re-import or re-declare them.
- **`ConnectionConfig` / `RegistryFile`** are already imported in `setup.ts`; reuse those types.
- **Exit codes:** parse errors and runtime errors both return `1` via `deps.err`; success returns `0`. `cli-bin.ts` maps the returned code to `process.exit`.
- **No `twenty-core` changes** in this plan — the registry mutators and `saveRegistryFile` already exist and are unit-tested.
