# Twenty Suite — Plan 1: Monorepo + Connection Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the v1 single-package Twenty CRM MCP into a pnpm monorepo (`twenty-core` + `twenty-crm-mcp`) and replace the static `{ baseUrl, apiKey }` config with a `Connection`/`CredentialProvider` abstraction (`getBearer()`), without changing observable behavior.

**Architecture:** `twenty-core` holds the reusable engine (transport clients, schema cache, generic primitive tools, server builder, auth abstraction). `twenty-crm-mcp` is a thin stdio entry that resolves the active connection and starts a core server. The transport clients stop reading a static API key and instead consume a `Connection` that yields a (later refreshable) bearer token; an `ApiKeyProvider` preserves today's behavior. OAuth, token store, profiles, and recipes are explicitly out of scope for this plan.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`), pnpm workspaces, tsup (bundle the app), vitest, zod v4, `@modelcontextprotocol/sdk`.

## Global Constraints

- Node `>=20` (native global `fetch`); ESM only.
- Package manager is **pnpm**. Install with bare `pnpm add <pkg>` — never `@latest`; the supply-chain age guard (`minimumReleaseAge: 1440`) lives in `pnpm-workspace.yaml`.
- **ESM with `.js` import extensions** on local imports (e.g. `import { x } from "./errors.js"`) even though sources are `.ts`.
- **stdout is reserved for the MCP protocol** — all diagnostics go to `console.error` (stderr).
- **Never log or echo the API key / bearer token.** Committed fixtures contain no real PII or tokens.
- Pinned dependency versions carried from v1: `@modelcontextprotocol/sdk@^1.29.0`, `zod@^4.4.3`, `tsup@^8.5.1`, `typescript@^6.0.3`, `vitest@^4.1.9`, `@types/node@^26.0.1`.
- This plan is **behavior-preserving**: the full test suite must stay green and the built `twenty-crm-mcp` binary must start exactly as v1 did (env `TWENTY_BASE_URL` + `TWENTY_API_KEY`).

---

### Task 1: Scaffold the monorepo workspace

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `package.json` (new root, replacing the v1 package root)
- Create: `tsconfig.base.json`
- Create: `packages/twenty-core/package.json`
- Create: `packages/twenty-core/tsconfig.json`
- Create: `packages/twenty-core/vitest.config.ts`
- Create: `packages/twenty-crm-mcp/package.json`
- Create: `packages/twenty-crm-mcp/tsconfig.json`
- Create: `packages/twenty-crm-mcp/vitest.config.ts`
- Create: `packages/twenty-crm-mcp/tsup.config.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a working pnpm workspace with two empty-source packages. `twenty-core` is consumed by `twenty-crm-mcp` via `"twenty-core": "workspace:*"` and exposes its barrel through `"exports": { ".": "./src/index.ts" }` (bundled by the app's tsup).

- [ ] **Step 1: Add the `packages` glob to the workspace file**

Edit `pnpm-workspace.yaml` to (keep the existing age guard and build approvals, add `packages`):

```yaml
packages:
  - "packages/*"
allowBuilds:
  esbuild: true
minimumReleaseAge: 1440
onlyBuiltDependencies:
  - esbuild
```

- [ ] **Step 2: Replace the root `package.json` with a private workspace root**

Overwrite `package.json` at the repo root:

```json
{
  "name": "twenty-mcp-suite",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "dev": "pnpm --filter twenty-crm-mcp dev"
  }
}
```

- [ ] **Step 3: Create the shared TypeScript base config**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 4: Create the `twenty-core` package manifest and configs**

Create `packages/twenty-core/package.json`:

```json
{
  "name": "twenty-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "typescript": "^6.0.3",
    "vitest": "^4.1.9",
    "@types/node": "^26.0.1"
  }
}
```

Create `packages/twenty-core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src"]
}
```

Create `packages/twenty-core/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
```

- [ ] **Step 5: Create the `twenty-crm-mcp` package manifest and configs**

Create `packages/twenty-crm-mcp/package.json`:

```json
{
  "name": "twenty-crm-mcp",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "description": "Version-resilient MCP server for self-hosted Twenty CRM",
  "author": "Andrew / Five59 Labs",
  "keywords": ["mcp", "twenty", "crm", "model-context-protocol"],
  "bin": { "twenty-crm-mcp": "dist/index.js" },
  "files": ["dist", "skill", "README.md"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "tsup"
  },
  "dependencies": {
    "twenty-core": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "tsup": "^8.5.1",
    "typescript": "^6.0.3",
    "vitest": "^4.1.9",
    "@types/node": "^26.0.1"
  }
}
```

Create `packages/twenty-crm-mcp/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src"]
}
```

Create `packages/twenty-crm-mcp/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
```

Create `packages/twenty-crm-mcp/tsup.config.ts` (bundles the workspace `twenty-core` source into the binary so no separate core build/publish is needed):

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  noExternal: ["twenty-core"],
});
```

- [ ] **Step 6: Remove the now-superseded root build configs**

The root `tsup.config.ts` and root `vitest.config.ts` are replaced by per-package configs. Delete them:

```bash
git rm tsup.config.ts vitest.config.ts tsconfig.json
```

(The root `tsconfig.json` is replaced by `tsconfig.base.json` + per-package tsconfigs. Source files still live in `src/` until Task 2 moves them; that is expected and the workspace install does not need them.)

- [ ] **Step 7: Install and verify the workspace resolves**

Run: `pnpm install`
Expected: completes without error; `pnpm -r exec true` lists both `twenty-core` and `twenty-crm-mcp`.

Run: `pnpm -r exec node -e "console.log('ok')"`
Expected: prints `ok` once per package (2 lines).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo (twenty-core + twenty-crm-mcp)"
```

---

### Task 2: Migrate the v1 engine into the two packages (behavior-preserving)

**Files:**
- Move: `src/twenty/*` → `packages/twenty-core/src/twenty/*`
- Move: `src/schema/*` → `packages/twenty-core/src/schema/*`
- Move: `src/tools/*` → `packages/twenty-core/src/tools/*`
- Move: `src/config.ts` + `src/config.test.ts` → `packages/twenty-core/src/config.ts` + `config.test.ts`
- Move: `src/server.ts` + `src/server.test.ts` → `packages/twenty-core/src/server.ts` + `server.test.ts`
- Move: `src/index.ts` → `packages/twenty-crm-mcp/src/index.ts`
- Move: `src/version.ts` + `src/version.test.ts` → `packages/twenty-crm-mcp/src/version.ts` + `version.test.ts`
- Move: `skill/` → `packages/twenty-crm-mcp/skill/`
- Move: `README.md` → `packages/twenty-crm-mcp/README.md` (and add a short root README pointer)
- Create: `packages/twenty-core/src/index.ts` (barrel)
- Modify: `packages/twenty-core/src/server.ts` (drop the dependency on the moved `version.ts`)
- Modify: `packages/twenty-crm-mcp/src/index.ts` (import from `twenty-core`)

**Interfaces:**
- Consumes: the Task 1 workspace.
- Produces: `twenty-core` barrel exports — `RestClient`, `GraphQLClient`, `SchemaCache`, `fetchAllObjects`, `TwentyApiError`, `isSchemaDriftError`, `driftHint`, `withDriftHandling`, `buildTools`, `createServer`, `ToolDef`, `ObjectSchema`, `FieldSchema`, `TwentyConfig`, `loadConfig`. `createServer(config: TwentyConfig, fetchImpl?)` is unchanged from v1 except it takes a `name`/`version` via a new `meta` arg (see Step 4).

- [ ] **Step 1: Move the engine source files into `twenty-core`**

```bash
mkdir -p packages/twenty-core/src
git mv src/twenty packages/twenty-core/src/twenty
git mv src/schema packages/twenty-core/src/schema
git mv src/tools packages/twenty-core/src/tools
git mv src/config.ts packages/twenty-core/src/config.ts
git mv src/config.test.ts packages/twenty-core/src/config.test.ts
git mv src/server.ts packages/twenty-core/src/server.ts
git mv src/server.test.ts packages/twenty-core/src/server.test.ts
```

All internal imports inside these files are relative (e.g. `../twenty/errors.js`) and keep the same relative structure, so they need no edits.

- [ ] **Step 2: Move the entry + version + skill + README into `twenty-crm-mcp`**

```bash
mkdir -p packages/twenty-crm-mcp/src
git mv src/index.ts packages/twenty-crm-mcp/src/index.ts
git mv src/version.ts packages/twenty-crm-mcp/src/version.ts
git mv src/version.test.ts packages/twenty-crm-mcp/src/version.test.ts
git mv skill packages/twenty-crm-mcp/skill
git mv README.md packages/twenty-crm-mcp/README.md
rmdir src
```

- [ ] **Step 3: Decouple `server.ts` from the moved `version.ts`**

`server.ts` previously imported `SERVER_NAME`/`SERVER_VERSION` from `./version.js`, which now lives in the app package. Make `createServer` take server identity as a parameter instead. Replace the top imports and the `createServer` signature in `packages/twenty-core/src/server.ts`.

Replace this import line:

```ts
import { SERVER_NAME, SERVER_VERSION } from "./version.js";
```

with a local type (no import needed):

```ts
export interface ServerMeta {
  name: string;
  version: string;
}
```

Then change the `createServer` signature and the `McpServer` construction. Replace:

```ts
export function createServer(
  config: TwentyConfig,
  fetchImpl: typeof fetch = fetch,
): { server: McpServer; cache: SchemaCache } {
  const rest = new RestClient(config, fetchImpl);
  const gql = new GraphQLClient(config, fetchImpl);
  const cache = new SchemaCache(rest);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
```

with:

```ts
export function createServer(
  config: TwentyConfig,
  meta: ServerMeta,
  fetchImpl: typeof fetch = fetch,
): { server: McpServer; cache: SchemaCache } {
  const rest = new RestClient(config, fetchImpl);
  const gql = new GraphQLClient(config, fetchImpl);
  const cache = new SchemaCache(rest);
  const server = new McpServer({ name: meta.name, version: meta.version });
```

(The rest of `createServer` — tool registration and the `twenty://schema` resource — is unchanged.)

- [ ] **Step 4: Create the `twenty-core` barrel**

Create `packages/twenty-core/src/index.ts`:

```ts
export { RestClient } from "./twenty/restClient.js";
export { GraphQLClient } from "./twenty/graphqlClient.js";
export { TwentyApiError, isSchemaDriftError, driftHint } from "./twenty/errors.js";
export { SchemaCache } from "./schema/cache.js";
export { fetchAllObjects } from "./schema/metadata.js";
export type { ObjectSchema, FieldSchema } from "./schema/types.js";
export { withDriftHandling } from "./tools/helpers.js";
export { schemaTools } from "./tools/schemaTools.js";
export type { ToolDef } from "./tools/schemaTools.js";
export { readTools } from "./tools/readTools.js";
export { writeTools } from "./tools/writeTools.js";
export { upsertTool } from "./tools/upsertTool.js";
export { buildTools, createServer } from "./server.js";
export type { ServerMeta } from "./server.js";
export { loadConfig } from "./config.js";
export type { TwentyConfig } from "./config.js";
```

- [ ] **Step 5: Rewrite the app entry to consume `twenty-core`**

Overwrite `packages/twenty-crm-mcp/src/index.ts`:

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, createServer } from "twenty-core";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const { server } = createServer(config, { name: SERVER_NAME, version: SERVER_VERSION });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 6: Update `server.test.ts` for the new `createServer` arity**

`server.test.ts` only calls `buildTools` directly, which is unchanged, so it needs no edit. Confirm by reading it; if any call to `createServer` exists, add the `{ name: "test", version: "0" }` meta arg as the second argument.

- [ ] **Step 7: Add a short root README pointer**

Create `README.md` at the repo root:

```markdown
# Twenty MCP Suite

A modular MCP suite for self-hosted Twenty CRM.

- [`packages/twenty-core`](packages/twenty-core) — reusable engine (transport, schema cache, generic primitives, auth).
- [`packages/twenty-crm-mcp`](packages/twenty-crm-mcp) — the CRM segment (stdio MCP server). See its [README](packages/twenty-crm-mcp/README.md).

Design + plans live in [`docs/superpowers/`](docs/superpowers/).
```

- [ ] **Step 8: Install, build, and run the full suite**

Run: `pnpm install`
Expected: succeeds; `twenty-crm-mcp` shows a linked `twenty-core` workspace dependency.

Run: `pnpm -r test`
Expected: PASS — all migrated v1 tests green in both packages.

Run: `pnpm --filter twenty-crm-mcp build`
Expected: produces `packages/twenty-crm-mcp/dist/index.js` with the `#!/usr/bin/env node` shebang.

Run: `TWENTY_BASE_URL=https://x TWENTY_API_KEY=k node -e "import('@modelcontextprotocol/sdk/server/stdio.js').then(()=>console.log('imports-ok'))"`
Expected: prints `imports-ok` (sanity that the SDK resolves under the workspace).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: migrate v1 engine into twenty-core + twenty-crm-mcp packages"
```

---

### Task 3: Add the `Connection` + `CredentialProvider` abstraction

**Files:**
- Create: `packages/twenty-core/src/auth/types.ts`
- Create: `packages/twenty-core/src/auth/apiKeyProvider.ts`
- Test: `packages/twenty-core/src/auth/apiKeyProvider.test.ts`
- Modify: `packages/twenty-core/src/index.ts` (export the new types/class)

**Interfaces:**
- Consumes: nothing from earlier tasks (additive).
- Produces:
  - `interface CredentialProvider { getBearer(): Promise<string> }`
  - `interface Connection { label: string; baseUrl: string; env?: string; getBearer(): Promise<string> }`
  - `class ApiKeyProvider implements CredentialProvider` with `constructor(apiKey: string)` and `getBearer(): Promise<string>` returning that key.

- [ ] **Step 1: Write the failing test**

Create `packages/twenty-core/src/auth/apiKeyProvider.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ApiKeyProvider } from "./apiKeyProvider.js";

describe("ApiKeyProvider", () => {
  it("returns the configured key as the bearer", async () => {
    const provider = new ApiKeyProvider("secret-key");
    expect(await provider.getBearer()).toBe("secret-key");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter twenty-core test src/auth/apiKeyProvider.test.ts`
Expected: FAIL — cannot resolve `./apiKeyProvider.js`.

- [ ] **Step 3: Write the types**

Create `packages/twenty-core/src/auth/types.ts`:

```ts
/** Yields a valid (later auto-refreshed) bearer token for Twenty API calls. */
export interface CredentialProvider {
  getBearer(): Promise<string>;
}

/** A resolved, named Twenty endpoint plus its credential provider. */
export interface Connection {
  label: string;
  baseUrl: string;
  env?: string;
  getBearer(): Promise<string>;
}
```

- [ ] **Step 4: Write the API-key provider**

Create `packages/twenty-core/src/auth/apiKeyProvider.ts`:

```ts
import type { CredentialProvider } from "./types.js";

/** Static API-key credential: the key is the bearer, with no refresh. */
export class ApiKeyProvider implements CredentialProvider {
  constructor(private readonly apiKey: string) {}

  async getBearer(): Promise<string> {
    return this.apiKey;
  }
}
```

- [ ] **Step 5: Export from the barrel**

Add to `packages/twenty-core/src/index.ts`:

```ts
export type { Connection, CredentialProvider } from "./auth/types.js";
export { ApiKeyProvider } from "./auth/apiKeyProvider.js";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter twenty-core test src/auth/apiKeyProvider.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add Connection + CredentialProvider abstraction with ApiKeyProvider"
```

---

### Task 4: Connection registry loader + legacy env fallback + `resolveActiveConnection`

**Files:**
- Create: `packages/twenty-core/src/auth/registry.ts`
- Test: `packages/twenty-core/src/auth/registry.test.ts`
- Modify: `packages/twenty-core/src/index.ts` (exports)

**Interfaces:**
- Consumes: `Connection` (Task 3), `ApiKeyProvider` (Task 3).
- Produces:
  - `interface ConnectionConfig { baseUrl: string; env?: string; auth: "apikey" | "oauth" }`
  - `interface RegistryFile { defaultConnection?: string; connections: Record<string, ConnectionConfig> }`
  - `function legacyConnectionFromEnv(env: NodeJS.ProcessEnv): Connection | null`
  - `function buildConnectionFromConfig(label: string, cfg: ConnectionConfig, env: NodeJS.ProcessEnv): Connection`
  - `function resolveActiveConnection(env: NodeJS.ProcessEnv, opts?: { registry?: RegistryFile }): Connection`
  - For `auth: "apikey"`, the key is read from `TWENTY_API_KEY_<LABEL>` (label uppercased, `-`→`_`) and falls back to `TWENTY_API_KEY`. `auth: "oauth"` throws a "not implemented until Plan 2" error.

- [ ] **Step 1: Write the failing tests**

Create `packages/twenty-core/src/auth/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  legacyConnectionFromEnv,
  buildConnectionFromConfig,
  resolveActiveConnection,
} from "./registry.js";
import type { RegistryFile } from "./registry.js";

const registry: RegistryFile = {
  defaultConnection: "acme-prod",
  connections: {
    "acme-prod": { baseUrl: "https://crm.acme.com", env: "prod", auth: "apikey" },
    "acme-oauth": { baseUrl: "https://oauth.acme.com", env: "prod", auth: "oauth" },
  },
};

describe("legacyConnectionFromEnv", () => {
  it("synthesizes a 'default' connection from TWENTY_BASE_URL + TWENTY_API_KEY and strips the trailing slash", async () => {
    const conn = legacyConnectionFromEnv({
      TWENTY_BASE_URL: "https://crm.example.com/",
      TWENTY_API_KEY: "k",
    });
    expect(conn).not.toBeNull();
    expect(conn!.label).toBe("default");
    expect(conn!.baseUrl).toBe("https://crm.example.com");
    expect(await conn!.getBearer()).toBe("k");
  });

  it("returns null when the legacy env vars are absent", () => {
    expect(legacyConnectionFromEnv({})).toBeNull();
  });
});

describe("buildConnectionFromConfig", () => {
  it("reads the per-label API key TWENTY_API_KEY_<LABEL>", async () => {
    const conn = buildConnectionFromConfig("acme-prod", registry.connections["acme-prod"], {
      TWENTY_API_KEY_ACME_PROD: "acme-key",
    });
    expect(conn.baseUrl).toBe("https://crm.acme.com");
    expect(await conn.getBearer()).toBe("acme-key");
  });

  it("falls back to TWENTY_API_KEY when no per-label key is set", async () => {
    const conn = buildConnectionFromConfig("acme-prod", registry.connections["acme-prod"], {
      TWENTY_API_KEY: "shared-key",
    });
    expect(await conn.getBearer()).toBe("shared-key");
  });

  it("throws an actionable error when an apikey connection has no key", () => {
    expect(() => buildConnectionFromConfig("acme-prod", registry.connections["acme-prod"], {})).toThrow(
      /TWENTY_API_KEY_ACME_PROD/,
    );
  });

  it("throws 'Plan 2' for oauth connections", () => {
    expect(() => buildConnectionFromConfig("acme-oauth", registry.connections["acme-oauth"], {})).toThrow(
      /OAuth/,
    );
  });
});

describe("resolveActiveConnection", () => {
  it("picks TWENTY_CONNECTION from the registry", async () => {
    const conn = resolveActiveConnection(
      { TWENTY_CONNECTION: "acme-prod", TWENTY_API_KEY_ACME_PROD: "acme-key" },
      { registry },
    );
    expect(conn.label).toBe("acme-prod");
    expect(await conn.getBearer()).toBe("acme-key");
  });

  it("falls back to the registry defaultConnection", () => {
    const conn = resolveActiveConnection({ TWENTY_API_KEY_ACME_PROD: "acme-key" }, { registry });
    expect(conn.label).toBe("acme-prod");
  });

  it("throws when TWENTY_CONNECTION names an unknown label", () => {
    expect(() =>
      resolveActiveConnection({ TWENTY_CONNECTION: "nope" }, { registry }),
    ).toThrow(/nope/);
  });

  it("uses the legacy env when no registry is provided", async () => {
    const conn = resolveActiveConnection({ TWENTY_BASE_URL: "https://x", TWENTY_API_KEY: "k" });
    expect(conn.label).toBe("default");
    expect(await conn.getBearer()).toBe("k");
  });

  it("throws an actionable error when nothing is configured", () => {
    expect(() => resolveActiveConnection({})).toThrow(/TWENTY_BASE_URL/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter twenty-core test src/auth/registry.test.ts`
Expected: FAIL — cannot resolve `./registry.js`.

- [ ] **Step 3: Write the registry module**

Create `packages/twenty-core/src/auth/registry.ts`:

```ts
import { ApiKeyProvider } from "./apiKeyProvider.js";
import type { Connection } from "./types.js";

export interface ConnectionConfig {
  baseUrl: string;
  env?: string;
  auth: "apikey" | "oauth";
}

export interface RegistryFile {
  defaultConnection?: string;
  connections: Record<string, ConnectionConfig>;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function envKeyForLabel(label: string): string {
  return "TWENTY_API_KEY_" + label.toUpperCase().replace(/-/g, "_");
}

export function legacyConnectionFromEnv(env: NodeJS.ProcessEnv): Connection | null {
  const baseUrl = env.TWENTY_BASE_URL?.trim();
  const apiKey = env.TWENTY_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  const provider = new ApiKeyProvider(apiKey);
  return {
    label: "default",
    baseUrl: stripTrailingSlash(baseUrl),
    getBearer: () => provider.getBearer(),
  };
}

export function buildConnectionFromConfig(
  label: string,
  cfg: ConnectionConfig,
  env: NodeJS.ProcessEnv,
): Connection {
  if (cfg.auth === "oauth") {
    throw new Error(
      `Connection "${label}" uses OAuth, which is not supported until Plan 2. ` +
        `Use an apikey connection for now.`,
    );
  }
  const perLabel = envKeyForLabel(label);
  const apiKey = env[perLabel]?.trim() || env.TWENTY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      `No API key for connection "${label}". Set ${perLabel} (or TWENTY_API_KEY) in the environment.`,
    );
  }
  const provider = new ApiKeyProvider(apiKey);
  return {
    label,
    baseUrl: stripTrailingSlash(cfg.baseUrl),
    env: cfg.env,
    getBearer: () => provider.getBearer(),
  };
}

export function resolveActiveConnection(
  env: NodeJS.ProcessEnv,
  opts?: { registry?: RegistryFile },
): Connection {
  const registry = opts?.registry;
  if (registry) {
    const label = env.TWENTY_CONNECTION?.trim() || registry.defaultConnection;
    if (!label) {
      throw new Error(
        "No active connection. Set TWENTY_CONNECTION or a defaultConnection in the registry.",
      );
    }
    const cfg = registry.connections[label];
    if (!cfg) {
      throw new Error(
        `Unknown connection "${label}". Known connections: ${Object.keys(registry.connections).join(", ") || "(none)"}.`,
      );
    }
    return buildConnectionFromConfig(label, cfg, env);
  }

  const legacy = legacyConnectionFromEnv(env);
  if (legacy) return legacy;

  throw new Error(
    "No Twenty connection configured. Set TWENTY_BASE_URL and TWENTY_API_KEY, " +
      "or provide a connection registry.",
  );
}
```

- [ ] **Step 4: Export from the barrel**

Add to `packages/twenty-core/src/index.ts`:

```ts
export {
  legacyConnectionFromEnv,
  buildConnectionFromConfig,
  resolveActiveConnection,
} from "./auth/registry.js";
export type { ConnectionConfig, RegistryFile } from "./auth/registry.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter twenty-core test src/auth/registry.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): connection registry + legacy env fallback + resolveActiveConnection"
```

---

### Task 5: Cut the transport + server wiring over to `Connection` (atomic swap)

This is the single behavior-preserving cutover: the clients stop reading `TwentyConfig.apiKey` and instead consume a `Connection`, `createServer` takes a `Connection`, the app resolves the active connection, and the old `config.ts` is removed. Done as one task so the tree never sits in a half-migrated, non-compiling state.

**Files:**
- Modify: `packages/twenty-core/src/twenty/restClient.ts`
- Modify: `packages/twenty-core/src/twenty/restClient.test.ts`
- Modify: `packages/twenty-core/src/twenty/graphqlClient.ts`
- Modify: `packages/twenty-core/src/twenty/graphqlClient.test.ts`
- Modify: `packages/twenty-core/src/server.ts`
- Modify: `packages/twenty-core/src/server.test.ts`
- Modify: `packages/twenty-core/src/index.ts`
- Modify: `packages/twenty-crm-mcp/src/index.ts`
- Delete: `packages/twenty-core/src/config.ts`, `packages/twenty-core/src/config.test.ts`

**Interfaces:**
- Consumes: `Connection` (Task 3), `resolveActiveConnection` (Task 4).
- Produces:
  - `class RestClient` with `constructor(connection: Connection, fetchImpl?: typeof fetch)`; every request sets `Authorization: Bearer ${await connection.getBearer()}` and builds URLs from `connection.baseUrl`. Public methods unchanged: `get/post/patch/del`.
  - `class GraphQLClient` with `constructor(connection: Connection, fetchImpl?: typeof fetch)`; `request(query, variables)` unchanged.
  - `createServer(connection: Connection, meta: ServerMeta, fetchImpl?: typeof fetch)`.
  - `buildTools` signature unchanged.

- [ ] **Step 1: Update the `RestClient` test to construct with a fake `Connection`**

In `packages/twenty-core/src/twenty/restClient.test.ts`, replace the config constant with a connection factory and update the three `new RestClient(cfg, ...)` call sites.

Replace:

```ts
const cfg = { baseUrl: "https://crm.example.com", apiKey: "k" };
```

with:

```ts
import type { Connection } from "../auth/types.js";

function conn(): Connection {
  return {
    label: "test",
    baseUrl: "https://crm.example.com",
    getBearer: async () => "k",
  };
}
```

Then in each test replace `new RestClient(cfg, fetchImpl as unknown as typeof fetch)` with `new RestClient(conn(), fetchImpl as unknown as typeof fetch)`. The existing assertions (`Authorization` is `Bearer k`, URL is `https://crm.example.com/...`) stay identical.

- [ ] **Step 2: Run the RestClient test to verify it fails**

Run: `pnpm --filter twenty-core test src/twenty/restClient.test.ts`
Expected: FAIL — `RestClient` still expects a config object; `connection.getBearer` is not used yet (type error or wrong header).

- [ ] **Step 3: Refactor `RestClient` to consume a `Connection`**

Overwrite `packages/twenty-core/src/twenty/restClient.ts`:

```ts
import type { Connection } from "../auth/types.js";
import { TwentyApiError } from "./errors.js";

type Query = Record<string, string | number | undefined>;

export class RestClient {
  constructor(
    private readonly connection: Connection,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get(path: string, query?: Query): Promise<unknown> {
    return this.request("GET", path, undefined, query);
  }
  post(path: string, body: unknown): Promise<unknown> {
    return this.request("POST", path, body);
  }
  patch(path: string, body: unknown): Promise<unknown> {
    return this.request("PATCH", path, body);
  }
  del(path: string): Promise<unknown> {
    return this.request("DELETE", path);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    query?: Query,
  ): Promise<unknown> {
    const url = new URL(this.connection.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    const bearer = await this.connection.getBearer();
    const res = await this.fetchImpl(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!res.ok) {
      throw new TwentyApiError(
        `Twenty REST ${method} ${path} failed (${res.status})`,
        res.status,
        parsed ?? text,
        url.toString(),
      );
    }
    return parsed;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
```

- [ ] **Step 4: Run the RestClient test to verify it passes**

Run: `pnpm --filter twenty-core test src/twenty/restClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the `GraphQLClient` test to use a fake `Connection`**

In `packages/twenty-core/src/twenty/graphqlClient.test.ts`, replace:

```ts
const cfg = { baseUrl: "https://crm.example.com", apiKey: "k" };
```

with:

```ts
import type { Connection } from "../auth/types.js";

function conn(): Connection {
  return { label: "test", baseUrl: "https://crm.example.com", getBearer: async () => "k" };
}
```

and replace every `new GraphQLClient(cfg, ...)` with `new GraphQLClient(conn(), ...)`. Assertions are unchanged.

- [ ] **Step 6: Run the GraphQLClient test to verify it fails**

Run: `pnpm --filter twenty-core test src/twenty/graphqlClient.test.ts`
Expected: FAIL — constructor still expects config.

- [ ] **Step 7: Refactor `GraphQLClient` to consume a `Connection`**

Overwrite `packages/twenty-core/src/twenty/graphqlClient.ts`:

```ts
import type { Connection } from "../auth/types.js";
import { TwentyApiError } from "./errors.js";

export class GraphQLClient {
  constructor(
    private readonly connection: Connection,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const url = `${this.connection.baseUrl}/graphql`;
    const bearer = await this.connection.getBearer();
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    const parsed = text ? safeJson(text) : {};
    if (!res.ok) {
      throw new TwentyApiError(`Twenty GraphQL failed (${res.status})`, res.status, parsed, url);
    }
    const data = parsed as { errors?: unknown; data?: unknown };
    if (data.errors) {
      throw new TwentyApiError("Twenty GraphQL returned errors", res.status, data.errors, url);
    }
    return data.data;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
```

- [ ] **Step 8: Run the GraphQLClient test to verify it passes**

Run: `pnpm --filter twenty-core test src/twenty/graphqlClient.test.ts`
Expected: PASS.

- [ ] **Step 9: Update `createServer` and `server.test.ts` to take a `Connection`**

In `packages/twenty-core/src/server.ts`, replace the import and the `createServer` signature/body opening.

Replace:

```ts
import type { TwentyConfig } from "./config.js";
```

with:

```ts
import type { Connection } from "./auth/types.js";
```

Replace:

```ts
export function createServer(
  config: TwentyConfig,
  meta: ServerMeta,
  fetchImpl: typeof fetch = fetch,
): { server: McpServer; cache: SchemaCache } {
  const rest = new RestClient(config, fetchImpl);
  const gql = new GraphQLClient(config, fetchImpl);
```

with:

```ts
export function createServer(
  connection: Connection,
  meta: ServerMeta,
  fetchImpl: typeof fetch = fetch,
): { server: McpServer; cache: SchemaCache } {
  const rest = new RestClient(connection, fetchImpl);
  const gql = new GraphQLClient(connection, fetchImpl);
```

Then in `packages/twenty-core/src/server.test.ts`, replace:

```ts
const cfg = { baseUrl: "https://x", apiKey: "k" };
```

with:

```ts
import type { Connection } from "./auth/types.js";

const conn: Connection = { label: "test", baseUrl: "https://x", getBearer: async () => "k" };
```

and replace the two client constructions inside the test:

```ts
    const rest = new RestClient(cfg, vi.fn() as unknown as typeof fetch);
    const gql = new GraphQLClient(cfg, vi.fn() as unknown as typeof fetch);
```

with:

```ts
    const rest = new RestClient(conn, vi.fn() as unknown as typeof fetch);
    const gql = new GraphQLClient(conn, vi.fn() as unknown as typeof fetch);
```

- [ ] **Step 10: Remove `config.ts`/`config.test.ts` and drop their barrel exports**

```bash
git rm packages/twenty-core/src/config.ts packages/twenty-core/src/config.test.ts
```

In `packages/twenty-core/src/index.ts`, delete these two lines:

```ts
export { loadConfig } from "./config.js";
export type { TwentyConfig } from "./config.js";
```

(The actionable "missing base URL / API key" error messages that `loadConfig` used to assert are now covered by `resolveActiveConnection` in Task 4's tests.)

- [ ] **Step 11: Wire `resolveActiveConnection` into the app entry**

Overwrite `packages/twenty-crm-mcp/src/index.ts`:

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveActiveConnection, createServer } from "twenty-core";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

async function main(): Promise<void> {
  const connection = resolveActiveConnection(process.env);
  const { server } = createServer(connection, { name: SERVER_NAME, version: SERVER_VERSION });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

(`resolveActiveConnection(process.env)` with no registry uses the legacy `TWENTY_BASE_URL` + `TWENTY_API_KEY` path — identical to v1 startup. The registry-file loader is added in Plan 2.)

- [ ] **Step 12: Run the full suite and build**

Run: `pnpm -r test`
Expected: PASS — all packages green, no reference to `config.js` or `TwentyConfig` remains.

Run: `pnpm --filter twenty-crm-mcp build`
Expected: produces `dist/index.js`; no unresolved-import errors for `twenty-core`.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "refactor: cut transport + server wiring over to the Connection abstraction"
```

---

## Self-Review

**Spec coverage (against the foundation design):**
- Monorepo (`packages/twenty-core` + `packages/twenty-crm-mcp`) — Tasks 1–2. ✅ (`shared-test-fixtures` and the ops/analytics/data packages are deliberately deferred — no shared-fixture consumer exists yet.)
- v1 migration, behavior-preserving — Task 2. ✅
- `getBearer()` internal contract; raw transport never exposed as a tool — Tasks 3, 5 (clients stay internal; no tool added). ✅
- Connection registry + named connections + legacy fallback — Task 4. ✅
- API-key provider as the no-friction fallback — Tasks 3–5. ✅
- **Out of scope for Plan 1 (covered by later plans):** OAuth provider, token store, setup CLI, active-connection `switch_connection` tool (Plan 2); `expand`/`aggregate`, profiles, recipes, audit, CRM curation, integration suite, `search`/`upsert` verification (Plan 3). The `oauth` auth type intentionally throws until Plan 2.

**Placeholder scan:** No TBD/TODO; every code step shows full file contents or exact replace-this-with-that blocks.

**Type consistency:** `Connection { label, baseUrl, env?, getBearer() }` and `CredentialProvider { getBearer() }` are defined in Task 3 and used unchanged in Tasks 4–5. `createServer(connection, meta, fetchImpl?)` arity is set in Task 2 (meta added) and its first param retyped in Task 5; `buildTools` is never re-signed. `resolveActiveConnection(env, { registry })` matches between Task 4's definition and Task 5's app usage (no registry → legacy path).

**Note for the implementer:** verify `pnpm install` re-links the `twenty-core` workspace dependency after Task 1 before moving code in Task 2; a stale lockfile is the most likely snag.
