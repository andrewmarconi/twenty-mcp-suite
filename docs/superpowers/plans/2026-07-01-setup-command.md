# `twenty-mcp setup` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive `setup` command to the `twenty-mcp` CLI that creates and manages the connection registry (`connections.json`) — add/edit/remove sites, set default, and offer OAuth sign-in.

**Architecture:** Pure registry mutators live in `twenty-core` (unit-tested, no I/O beyond a file write). The interactive orchestration lives in `twenty-crm-mcp` behind a `PromptAPI` interface (a thin wrapper over `@clack/prompts`) so it is unit-testable with scripted fakes. `cli.ts` gains one `setup` branch.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), pnpm workspaces, vitest, `@clack/prompts`.

## Global Constraints

- Package manager is **pnpm**; install with bare `pnpm add <pkg>` (never `@latest` / `@version`) — the `minimumReleaseAge: 1440` guard in `pnpm-workspace.yaml` picks a safe version.
- **ESM with `.js` import extensions** for local imports (e.g. `import { x } from "./prompts.js"`), even though sources are `.ts`.
- **stdout is reserved for the MCP protocol** in the server, but the CLI is a standalone process — `setup` may write to stdout/`@clack` freely. Keep server code untouched.
- **Never write secrets to `connections.json`.** API keys stay in env; OAuth tokens stay in the encrypted `FileTokenStore`.
- Node >= 20. Must work identically on **Windows and macOS** (`@clack/prompts` is pure-JS; no shell-specific code).
- Tests inject fakes (no network, no real TTY). Tool/handler functions return values or write via injected deps; assert on those.
- Config-path resolution must match `cli.ts` `realDeps` exactly: `env.TWENTY_MCP_CONFIG?.trim() ?? join(defaultConfigDir(env), "connections.json")`.

---

### Task 1: Registry mutators + `saveRegistryFile` (twenty-core)

Pure functions that create/replace/remove connections and persist the registry. No prompts, no network.

**Files:**
- Modify: `packages/twenty-core/src/auth/registry.ts`
- Modify: `packages/twenty-core/src/index.ts`
- Test: `packages/twenty-core/src/auth/registry.test.ts` (may already exist — add a `describe` block; create the file if absent)

**Interfaces:**
- Consumes: existing `RegistryFile`, `ConnectionConfig` (already in `registry.ts`); existing `loadRegistryFile(path)`.
- Produces (all exported from `twenty-core`):
  - `saveRegistryFile(path: string, reg: RegistryFile): void`
  - `upsertConnection(reg: RegistryFile, label: string, cfg: ConnectionConfig): RegistryFile`
  - `removeConnection(reg: RegistryFile, label: string): RegistryFile`
  - `setDefaultConnection(reg: RegistryFile, label: string): RegistryFile`
  - `envKeyForLabel(label: string): string` (promote the existing private function to exported)

- [ ] **Step 1: Write the failing tests**

Append to `packages/twenty-core/src/auth/registry.test.ts` (add imports at top of the file; if the file does not exist, create it with these imports):

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  saveRegistryFile,
  loadRegistryFile,
  upsertConnection,
  removeConnection,
  setDefaultConnection,
  envKeyForLabel,
  type RegistryFile,
} from "./registry.js";

describe("registry mutators", () => {
  it("saveRegistryFile writes JSON that loadRegistryFile round-trips, creating the dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "twenty-reg-"));
    const path = join(dir, "nested", "connections.json");
    const reg: RegistryFile = {
      defaultConnection: "acme",
      connections: { acme: { baseUrl: "https://crm.acme.com", auth: "oauth" } },
    };
    saveRegistryFile(path, reg);
    expect(existsSync(path)).toBe(true);
    expect(loadRegistryFile(path)).toEqual(reg);
  });

  it("upsertConnection adds and replaces without mutating the input", () => {
    const reg: RegistryFile = { connections: {} };
    const added = upsertConnection(reg, "acme", { baseUrl: "https://a.com", auth: "oauth" });
    expect(added.connections.acme).toEqual({ baseUrl: "https://a.com", auth: "oauth" });
    expect(reg.connections).toEqual({}); // input untouched
    const replaced = upsertConnection(added, "acme", { baseUrl: "https://b.com", auth: "apikey" });
    expect(replaced.connections.acme).toEqual({ baseUrl: "https://b.com", auth: "apikey" });
  });

  it("removeConnection deletes the label and clears defaultConnection when it pointed at it", () => {
    const reg: RegistryFile = {
      defaultConnection: "acme",
      connections: { acme: { baseUrl: "https://a.com", auth: "oauth" } },
    };
    const next = removeConnection(reg, "acme");
    expect(next.connections.acme).toBeUndefined();
    expect(next.defaultConnection).toBeUndefined();
  });

  it("removeConnection keeps a default that points elsewhere", () => {
    const reg: RegistryFile = {
      defaultConnection: "keep",
      connections: {
        keep: { baseUrl: "https://k.com", auth: "oauth" },
        drop: { baseUrl: "https://d.com", auth: "oauth" },
      },
    };
    const next = removeConnection(reg, "drop");
    expect(next.defaultConnection).toBe("keep");
  });

  it("setDefaultConnection sets the field", () => {
    const reg: RegistryFile = { connections: { acme: { baseUrl: "https://a.com", auth: "oauth" } } };
    expect(setDefaultConnection(reg, "acme").defaultConnection).toBe("acme");
  });

  it("envKeyForLabel upcases and hyphen->underscore", () => {
    expect(envKeyForLabel("acme-dev")).toBe("TWENTY_API_KEY_ACME_DEV");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter twenty-core test src/auth/registry.test.ts`
Expected: FAIL — `saveRegistryFile is not a function` / `envKeyForLabel is not exported` (etc.).

- [ ] **Step 3: Implement the mutators**

In `packages/twenty-core/src/auth/registry.ts`, update the top imports to add `mkdirSync`/`writeFileSync` and `dirname`:

```ts
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
```

Change the existing `function envKeyForLabel` line to export it:

```ts
export function envKeyForLabel(label: string): string {
  return "TWENTY_API_KEY_" + label.toUpperCase().replace(/-/g, "_");
}
```

Add these functions to the file (below `loadRegistryFile`):

```ts
export function saveRegistryFile(path: string, reg: RegistryFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(reg, null, 2), { mode: 0o600 });
}

export function upsertConnection(
  reg: RegistryFile,
  label: string,
  cfg: ConnectionConfig,
): RegistryFile {
  return { ...reg, connections: { ...reg.connections, [label]: cfg } };
}

export function removeConnection(reg: RegistryFile, label: string): RegistryFile {
  const connections = { ...reg.connections };
  delete connections[label];
  const next: RegistryFile = { ...reg, connections };
  if (next.defaultConnection === label) delete next.defaultConnection;
  return next;
}

export function setDefaultConnection(reg: RegistryFile, label: string): RegistryFile {
  return { ...reg, defaultConnection: label };
}
```

- [ ] **Step 4: Export the new symbols from the package index**

In `packages/twenty-core/src/index.ts`, extend the existing `registry.js` export block to:

```ts
export {
  legacyConnectionFromEnv,
  buildConnectionFromConfig,
  resolveActiveConnection,
  loadRegistryFile,
  saveRegistryFile,
  upsertConnection,
  removeConnection,
  setDefaultConnection,
  envKeyForLabel,
} from "./auth/registry.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter twenty-core test src/auth/registry.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/twenty-core/src/auth/registry.ts packages/twenty-core/src/index.ts packages/twenty-core/src/auth/registry.test.ts
git commit -m "feat(core): registry mutators (save/upsert/remove/setDefault)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `PromptAPI` interface + `@clack/prompts` wrapper (twenty-crm-mcp)

A minimal prompt interface so `runSetup` never touches a real terminal in tests, plus the production wrapper over `@clack/prompts`.

**Files:**
- Modify: `packages/twenty-crm-mcp/package.json` (adds the dependency — done via `pnpm add`)
- Create: `packages/twenty-crm-mcp/src/prompts.ts`
- Test: `packages/twenty-crm-mcp/src/prompts.test.ts`

**Interfaces:**
- Produces:
  - `interface PromptAPI` with methods:
    - `intro(msg: string): void`
    - `outro(msg: string): void`
    - `note(msg: string, title?: string): void`
    - `text(opts: { message: string; placeholder?: string; initialValue?: string; validate?: (v: string) => string | undefined }): Promise<string | symbol>`
    - `select<T extends string>(opts: { message: string; options: Array<{ value: T; label: string; hint?: string }>; initialValue?: T }): Promise<T | symbol>`
    - `confirm(opts: { message: string }): Promise<boolean | symbol>`
    - `isCancel(value: unknown): value is symbol`
  - `clackPrompts(): PromptAPI` — production implementation.

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter twenty-crm-mcp add @clack/prompts`
Expected: `@clack/prompts` appears under `dependencies` in `packages/twenty-crm-mcp/package.json`. If you hit `ERR_PNPM_IGNORED_BUILDS`, no action needed here — `@clack/prompts` has no build script.

- [ ] **Step 2: Write the failing test**

Create `packages/twenty-crm-mcp/src/prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { clackPrompts, type PromptAPI } from "./prompts.js";

describe("clackPrompts", () => {
  it("exposes the full PromptAPI surface", () => {
    const p: PromptAPI = clackPrompts();
    for (const m of ["intro", "outro", "note", "text", "select", "confirm", "isCancel"] as const) {
      expect(typeof p[m]).toBe("function");
    }
  });

  it("isCancel recognizes the clack cancel symbol and rejects plain values", () => {
    const p = clackPrompts();
    expect(p.isCancel("hello")).toBe(false);
    expect(p.isCancel(undefined)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter twenty-crm-mcp test src/prompts.test.ts`
Expected: FAIL — cannot find module `./prompts.js`.

- [ ] **Step 4: Implement the wrapper**

Create `packages/twenty-crm-mcp/src/prompts.ts`:

```ts
import * as clack from "@clack/prompts";

export interface PromptAPI {
  intro(msg: string): void;
  outro(msg: string): void;
  note(msg: string, title?: string): void;
  text(opts: {
    message: string;
    placeholder?: string;
    initialValue?: string;
    validate?: (v: string) => string | undefined;
  }): Promise<string | symbol>;
  select<T extends string>(opts: {
    message: string;
    options: Array<{ value: T; label: string; hint?: string }>;
    initialValue?: T;
  }): Promise<T | symbol>;
  confirm(opts: { message: string }): Promise<boolean | symbol>;
  isCancel(value: unknown): value is symbol;
}

export function clackPrompts(): PromptAPI {
  return {
    intro: (msg) => clack.intro(msg),
    outro: (msg) => clack.outro(msg),
    note: (msg, title) => clack.note(msg, title),
    text: (opts) => clack.text(opts),
    select: (opts) => clack.select(opts) as Promise<string | symbol>,
    confirm: (opts) => clack.confirm(opts),
    isCancel: (value): value is symbol => clack.isCancel(value),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter twenty-crm-mcp test src/prompts.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/twenty-crm-mcp/package.json packages/twenty-crm-mcp/src/prompts.ts packages/twenty-crm-mcp/src/prompts.test.ts pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(cli): PromptAPI interface + @clack/prompts wrapper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `runSetup` — menu loop + Add-site flow (twenty-crm-mcp)

The core orchestration: main menu loop and the "Add a site" flow (both auth kinds), persisting after the mutation and offering OAuth sign-in.

**Files:**
- Create: `packages/twenty-crm-mcp/src/setup.ts`
- Test: `packages/twenty-crm-mcp/src/setup.test.ts`

**Interfaces:**
- Consumes: `PromptAPI` (Task 2); `upsertConnection`, `envKeyForLabel`, `type RegistryFile`, `type ConnectionConfig`, `loginConnection`, `type TokenStore` (from `twenty-core`, Task 1).
- Produces:
  - `interface SetupDeps { prompts: PromptAPI; loadRegistry(): RegistryFile | null; saveRegistry(reg: RegistryFile): void; store: TokenStore; login: typeof loginConnection; out(msg: string): void; err(msg: string): void; }`
  - `runSetup(deps: SetupDeps): Promise<number>`
  - Internal helper `isHttpUrl(v: string): boolean`

**Test harness note:** the fake `PromptAPI` is *scripted* — each `text`/`select`/`confirm` shifts the next answer off a queue. Include a helper in the test file:

```ts
function fakePrompts(answers: unknown[]) {
  const q = [...answers];
  const CANCEL = Symbol.for("clack.cancel");
  const next = () => (q.length ? q.shift() : CANCEL);
  return {
    api: {
      intro: () => {}, outro: () => {}, note: () => {},
      text: async () => next(),
      select: async () => next(),
      confirm: async () => next(),
      isCancel: (v: unknown) => v === CANCEL,
    },
    CANCEL,
  };
}

function deps(answers: unknown[], over: Record<string, unknown> = {}) {
  const saved: RegistryFile[] = [];
  return {
    saved,
    d: {
      prompts: fakePrompts(answers).api,
      loadRegistry: () => ({ connections: {} }),
      saveRegistry: (reg: RegistryFile) => { saved.push(reg); },
      store: { get: vi.fn(), set: vi.fn(), delete: vi.fn().mockResolvedValue(undefined), labels: vi.fn().mockResolvedValue([]) },
      login: vi.fn().mockResolvedValue(undefined),
      out: vi.fn(), err: vi.fn(),
      ...over,
    },
  };
}
```

- [ ] **Step 1: Write the failing tests (add flow)**

Create `packages/twenty-crm-mcp/src/setup.test.ts` with the harness above plus:

```ts
import { describe, it, expect, vi } from "vitest";
import { runSetup } from "./setup.js";
import type { RegistryFile } from "twenty-core";

describe("runSetup — add flow", () => {
  it("adds an oauth site, persists it, and runs login when 'sign in now' is yes", async () => {
    // menu:add, label, baseUrl, auth, confirm(sign in): true, menu:done
    const { saved, d } = deps(["add", "acme", "https://crm.acme.com", "oauth", true, "done"]);
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.acme).toEqual({ baseUrl: "https://crm.acme.com", auth: "oauth" });
    expect(d.login).toHaveBeenCalledWith(
      expect.objectContaining({ label: "acme", baseUrl: "https://crm.acme.com" }),
    );
  });

  it("adds an apikey site without calling login", async () => {
    const { saved, d } = deps(["add", "sandbox", "https://dev.acme.com", "apikey", "done"]);
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.sandbox).toEqual({ baseUrl: "https://dev.acme.com", auth: "apikey" });
    expect(d.login).not.toHaveBeenCalled();
  });

  it("keeps the site recorded even if login throws", async () => {
    const { saved, d } = deps(["add", "acme", "https://crm.acme.com", "oauth", true, "done"], {
      login: vi.fn().mockRejectedValue(new Error("browser closed")),
    });
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.acme).toBeDefined();
    expect(d.err).toHaveBeenCalledWith(expect.stringMatching(/browser closed/));
  });

  it("cancelling at the menu exits cleanly without saving", async () => {
    const { saved, d } = deps([]); // empty queue -> first select returns CANCEL
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(saved).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter twenty-crm-mcp test src/setup.test.ts`
Expected: FAIL — cannot find module `./setup.js`.

- [ ] **Step 3: Implement `runSetup` + add flow**

Create `packages/twenty-crm-mcp/src/setup.ts`:

```ts
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
```

Note: the menu only lists Add/Done for now; Task 4 adds edit/remove/default entries and handlers.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter twenty-crm-mcp test src/setup.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/twenty-crm-mcp/src/setup.ts packages/twenty-crm-mcp/src/setup.test.ts
git commit -m "feat(cli): runSetup menu loop + add-site flow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `runSetup` — edit / remove / set-default flows (twenty-crm-mcp)

Adds the remaining menu entries and their handlers.

**Files:**
- Modify: `packages/twenty-crm-mcp/src/setup.ts`
- Test: `packages/twenty-crm-mcp/src/setup.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `removeConnection`, `setDefaultConnection` (from `twenty-core`, Task 1), plus everything from Task 3.
- Produces: extended menu (`"add" | "edit" | "remove" | "default" | "done"`) and handlers `editSite`, `removeSite`, `chooseDefault`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/twenty-crm-mcp/src/setup.test.ts`. This block seeds a non-empty registry via a `loadRegistry` override:

```ts
describe("runSetup — edit/remove/default", () => {
  const seeded = (): RegistryFile => ({
    defaultConnection: "acme",
    connections: {
      acme: { baseUrl: "https://crm.acme.com", auth: "oauth" },
      sandbox: { baseUrl: "https://dev.acme.com", auth: "apikey" },
    },
  });

  it("edits a site's baseUrl (no rename)", async () => {
    // menu:edit, pick:acme, newLabel:acme, baseUrl, auth, menu:done
    const { saved, d } = deps(
      ["edit", "acme", "acme", "https://new.acme.com", "oauth", "done"],
      { loadRegistry: () => seeded() },
    );
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(saved.at(-1)!.connections.acme.baseUrl).toBe("https://new.acme.com");
  });

  it("renames a site and moves the default with it", async () => {
    // menu:edit, pick:acme, newLabel:acme-prod, baseUrl, auth, menu:done
    const { saved, d } = deps(
      ["edit", "acme", "acme-prod", "https://crm.acme.com", "oauth", "done"],
      { loadRegistry: () => seeded() },
    );
    await runSetup(d as never);
    const last = saved.at(-1)!;
    expect(last.connections.acme).toBeUndefined();
    expect(last.connections["acme-prod"]).toBeDefined();
    expect(last.defaultConnection).toBe("acme-prod");
  });

  it("removes a site after confirmation and offers to delete stored credentials", async () => {
    // menu:remove, pick:acme, confirm(remove):true, confirm(del creds):true, menu:done
    const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn().mockResolvedValue(undefined), labels: vi.fn().mockResolvedValue(["acme"]) };
    const { saved, d } = deps(
      ["remove", "acme", true, true, "done"],
      { loadRegistry: () => seeded(), store },
    );
    await runSetup(d as never);
    expect(saved.at(-1)!.connections.acme).toBeUndefined();
    expect(store.delete).toHaveBeenCalledWith("acme");
  });

  it("does not remove when the confirmation is declined", async () => {
    const { saved, d } = deps(
      ["remove", "sandbox", false, "done"],
      { loadRegistry: () => seeded() },
    );
    await runSetup(d as never);
    // no save happened for the decline; final registry still has sandbox
    const anySavedWithoutSandbox = saved.some((r) => !r.connections.sandbox);
    expect(anySavedWithoutSandbox).toBe(false);
  });

  it("sets the default connection", async () => {
    // menu:default, pick:sandbox, menu:done
    const { saved, d } = deps(
      ["default", "sandbox", "done"],
      { loadRegistry: () => seeded() },
    );
    await runSetup(d as never);
    expect(saved.at(-1)!.defaultConnection).toBe("sandbox");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter twenty-crm-mcp test src/setup.test.ts`
Expected: FAIL — edit/remove/default menu actions are not handled (registry unchanged), so the new assertions fail.

- [ ] **Step 3: Implement the handlers and extend the menu**

In `packages/twenty-crm-mcp/src/setup.ts`, extend the imports from `twenty-core` to add `removeConnection` and `setDefaultConnection`:

```ts
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
```

Add these three handlers (place above `runSetup`):

```ts
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
```

Replace the menu options and dispatch inside `runSetup`'s loop with:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter twenty-crm-mcp test src/setup.test.ts`
Expected: PASS (all add + edit/remove/default tests).

- [ ] **Step 5: Commit**

```bash
git add packages/twenty-crm-mcp/src/setup.ts packages/twenty-crm-mcp/src/setup.test.ts
git commit -m "feat(cli): setup edit/remove/set-default flows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire `setup` into the CLI + docs (twenty-crm-mcp)

Add the `setup` command branch, its production deps builder, update usage, and document the command.

**Files:**
- Modify: `packages/twenty-crm-mcp/src/cli.ts`
- Modify: `packages/twenty-crm-mcp/src/cli.test.ts`
- Modify: `packages/twenty-crm-mcp/README.md` (add a `setup` usage line)

**Interfaces:**
- Consumes: `runSetup`, `SetupDeps` (Task 3/4); `clackPrompts` (Task 2); `saveRegistryFile` (Task 1); existing `FileTokenStore`, `defaultConfigDir`, `loginConnection`, `loadRegistryFile`.
- Produces: `realSetupDeps(env): SetupDeps`; `setup` command in `runCli`.

- [ ] **Step 1: Write the failing test**

Add to `packages/twenty-crm-mcp/src/cli.test.ts`. First extend the `deps()` helper to include a `runSetup` stub, then add the test:

Add `runSetup: vi.fn().mockResolvedValue(0),` to the object returned by the `deps()` helper (alongside `login`, `out`, `err`).

```ts
  it("setup delegates to runSetup and returns its code", async () => {
    const d = deps();
    const code = await runCli(["setup"], d as never);
    expect(code).toBe(0);
    expect(d.runSetup).toHaveBeenCalled();
  });

  it("usage error mentions setup", async () => {
    const d = deps();
    await runCli(["frobnicate"], d as never);
    expect(d.err).toHaveBeenCalledWith(expect.stringMatching(/setup/));
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter twenty-crm-mcp test src/cli.test.ts`
Expected: FAIL — `setup` is treated as an unknown command (returns 1; `runSetup` never called) and USAGE has no `setup`.

- [ ] **Step 3: Implement the branch + deps builder**

In `packages/twenty-crm-mcp/src/cli.ts`, update imports:

```ts
import {
  loginConnection,
  loadRegistryFile,
  saveRegistryFile,
  FileTokenStore,
  defaultConfigDir,
  type TokenStore,
  type RegistryFile,
} from "twenty-core";
import { join } from "node:path";
import { runSetup, type SetupDeps } from "./setup.js";
import { clackPrompts } from "./prompts.js";
```

Add `runSetup` to the `CliDeps` interface:

```ts
export interface CliDeps {
  store: TokenStore;
  loadRegistry: () => RegistryFile | null;
  login: typeof loginConnection;
  runSetup: (deps: SetupDeps) => Promise<number>;
  out: (msg: string) => void;
  err: (msg: string) => void;
}
```

Add a `realSetupDeps` builder and wire `runSetup` into `realDeps`. Compute the config path once so both the registry loader and the setup saver share it:

```ts
export function realSetupDeps(env: NodeJS.ProcessEnv): SetupDeps {
  const dir = defaultConfigDir(env);
  const path = env.TWENTY_MCP_CONFIG?.trim() ?? join(dir, "connections.json");
  return {
    prompts: clackPrompts(),
    loadRegistry: () => loadRegistryFile(path),
    saveRegistry: (reg) => saveRegistryFile(path, reg),
    store: new FileTokenStore(dir),
    login: loginConnection,
    out: (m) => console.log(m),
    err: (m) => console.error(m),
  };
}
```

In `realDeps`, add the `runSetup` field to the returned object:

```ts
    login: loginConnection,
    runSetup: (setupDeps) => runSetup(setupDeps),
    out: (m) => console.log(m),
    err: (m) => console.error(m),
```

Update `USAGE`:

```ts
const USAGE =
  "usage: twenty-mcp <setup | login <label> | connections | logout <label>>";
```

Add the command branch inside `runCli` (before the final `deps.err(USAGE)`):

```ts
  if (cmd === "setup") {
    return deps.runSetup(realSetupDeps(process.env));
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter twenty-crm-mcp test src/cli.test.ts`
Expected: PASS (existing tests + the two new ones).

- [ ] **Step 5: Document the command**

In `packages/twenty-crm-mcp/README.md`, add a short entry under the CLI/usage section (create a "Setup" subsection near where `login`/`connections` are described, or if none exists, add near the top of the usage docs):

```markdown
### Setup

Run the interactive connection manager to create or edit `connections.json`:

```bash
npx twenty-crm-mcp setup   # or: twenty-mcp setup
```

It lets you add, edit, remove, and default Twenty sites, and can start the OAuth
browser sign-in immediately after adding an OAuth site. For API-key sites it prints
the exact environment variable to set (`TWENTY_API_KEY_<LABEL>`). No secrets are
written to `connections.json`.
```

- [ ] **Step 6: Full build + test sweep**

Run: `pnpm -r test && pnpm --filter twenty-crm-mcp build`
Expected: all tests PASS; build produces `dist/cli-bin.js` with no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/twenty-crm-mcp/src/cli.ts packages/twenty-crm-mcp/src/cli.test.ts packages/twenty-crm-mcp/README.md
git commit -m "feat(cli): wire setup command + docs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manual verification (after all tasks)

Run the real command against a scratch config to confirm the TUI works end-to-end on your machine (and, ideally, once on Windows):

```bash
TWENTY_MCP_CONFIG=/tmp/twenty-test-connections.json node packages/twenty-crm-mcp/dist/cli-bin.js setup
```

Add an API-key site, confirm the env-var note prints, choose "Done", and verify
`/tmp/twenty-test-connections.json` contains the expected JSON with no secrets.
