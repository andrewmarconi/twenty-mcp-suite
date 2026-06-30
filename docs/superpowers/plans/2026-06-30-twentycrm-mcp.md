# TwentyCRM MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a version-resilient, metadata-driven MCP server for self-hosted Twenty CRM, exposing ~10 generic schema-aware tools plus a companion Skill.

**Architecture:** A thin REST client drives Twenty's Core API for record CRUD and Metadata API for schema discovery; a minimal GraphQL client handles only batch upsert. An in-memory schema cache, lazy-loaded from the Metadata API, maps every object (built-in and custom) to its plural REST path and fields. All tools resolve their `object` argument against this cache, so Twenty version/schema changes are handled by `refresh_schema`, never a code release.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` (stdio transport), `zod` for tool input schemas, `vitest` for tests, native `fetch`, `tsup` for build. Published to npm, run via `npx`.

## Global Constraints

- Package manager: **pnpm** (not npm) for all installs and scripts, per the user's standard tooling. Configure the supply-chain age guard (`minimumReleaseAge`) and build-script approvals (`onlyBuiltDependencies`, e.g. `esbuild` for tsup) in `pnpm-workspace.yaml`. Let pnpm pick safe versions under the age guard — bare `pnpm add`, never `@latest`. If `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`, add the named package to `onlyBuiltDependencies` and reinstall.
- Runtime: Node.js >= 20 (native global `fetch`). Declare `"engines": { "node": ">=20" }`.
- Transport: stdio only. No HTTP/remote/multi-tenant.
- Config via env only: `TWENTY_BASE_URL`, `TWENTY_API_KEY`. No other required config.
- Auth header: `Authorization: Bearer ${TWENTY_API_KEY}` on every request.
- REST-first for record CRUD and schema; GraphQL used ONLY for `upsert_records`.
- Write tools are batch-native: input is always an array of 1–60 records.
- Schema drift handling is MANUAL: on a schema-mismatch error, tools return a message that explicitly names `refresh_schema`; no silent auto-heal.
- Schema cache is lazy-loaded on first use (server must start even if Twenty is unreachable).
- Never log or echo `TWENTY_API_KEY`. Fixtures committed to the repo must not contain real PII or tokens.
- Verified-real Metadata API response shape (captured from a live v2.17.2 instance):
  `{ "data": [ { "nameSingular", "namePlural", "labelSingular", "labelPlural", "isActive", "isSystem", "isSearchable", "labelIdentifierFieldMetadataId", "fields": [ { "type", "name", "label", "isNullable", "isUnique", "isActive", "isSystem", "settings", "relation"? } ] } ], "pageInfo"?, "totalCount"? }`. Metadata field `type` values seen: `TEXT`, `POSITION`, `TS_VECTOR`, `RELATION`, `UUID`, `DATE_TIME`, `NUMBER`, `BOOLEAN`, `SELECT`, `EMAILS`, etc.

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `src/index.ts`
- Create: `src/version.test.ts`
- Modify: `.gitignore` (already has node_modules/, dist/, .env)

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable, testable TypeScript project. `pnpm build` emits `dist/index.js` with a shebang; `pnpm test` runs vitest.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "twentycrm-mcp",
  "version": "0.1.0",
  "description": "Version-resilient MCP server for self-hosted Twenty CRM",
  "type": "module",
  "bin": { "twentycrm-mcp": "dist/index.js" },
  "files": ["dist", "skill", "README.md"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "prepublishOnly": "tsup"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "tsup": "latest",
    "typescript": "latest",
    "vitest": "latest",
    "@types/node": "latest"
  }
}
```

Then run `pnpm install` (the package manager picks safe versions per the supply-chain age guard; do not pin `@latest` by hand). After install, replace each `"latest"` with the resolved version range pnpm wrote into the lockfile. Keep `"prepublishOnly": "tsup"` (PM-agnostic) so publishing doesn't assume a package manager.

- [ ] **Step 1b: Create `pnpm-workspace.yaml`** (supply-chain age guard + build-script approvals)

```yaml
minimumReleaseAge: 1440
onlyBuiltDependencies:
  - esbuild
```

If `pnpm install` later reports `ERR_PNPM_IGNORED_BUILDS` for another package, add that package name under `onlyBuiltDependencies` and reinstall.

- [ ] **Step 2: Create `tsconfig.json`**

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
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `tsup.config.ts`**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Create `.env.example`**

```
TWENTY_BASE_URL=https://crm.example.com
TWENTY_API_KEY=your-api-key-here
```

- [ ] **Step 6: Write the failing test `src/version.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

describe("version", () => {
  it("exposes a server name and semver version", () => {
    expect(SERVER_NAME).toBe("twentycrm-mcp");
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot resolve `./version.js`.

- [ ] **Step 8: Create `src/version.ts`**

```typescript
export const SERVER_NAME = "twentycrm-mcp";
export const SERVER_VERSION = "0.1.0";
```

- [ ] **Step 9: Create minimal `src/index.ts`**

```typescript
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
```

- [ ] **Step 10: Run test + build to verify both pass**

Run: `pnpm test && pnpm build`
Expected: test PASS; build emits `dist/index.js`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold TwentyCRM MCP TypeScript project"
```

---

### Task 2: Config loading and validation

**Files:**
- Create: `src/config.ts`
- Create: `src/config.test.ts`

**Interfaces:**
- Produces: `interface TwentyConfig { baseUrl: string; apiKey: string }` and `loadConfig(env: NodeJS.ProcessEnv): TwentyConfig`. `baseUrl` is normalized to have no trailing slash. Throws `Error` with an actionable message when a var is missing.

- [ ] **Step 1: Write the failing test `src/config.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("reads and normalizes a valid env", () => {
    const cfg = loadConfig({
      TWENTY_BASE_URL: "https://crm.example.com/",
      TWENTY_API_KEY: "abc123",
    });
    expect(cfg.baseUrl).toBe("https://crm.example.com");
    expect(cfg.apiKey).toBe("abc123");
  });

  it("throws when TWENTY_API_KEY is missing", () => {
    expect(() => loadConfig({ TWENTY_BASE_URL: "https://x" })).toThrow(
      /TWENTY_API_KEY/,
    );
  });

  it("throws when TWENTY_BASE_URL is missing", () => {
    expect(() => loadConfig({ TWENTY_API_KEY: "k" })).toThrow(
      /TWENTY_BASE_URL/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/config.test.ts`
Expected: FAIL — cannot resolve `./config.js`.

- [ ] **Step 3: Implement `src/config.ts`**

```typescript
export interface TwentyConfig {
  baseUrl: string;
  apiKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): TwentyConfig {
  const baseUrl = env.TWENTY_BASE_URL?.trim();
  const apiKey = env.TWENTY_API_KEY?.trim();

  if (!baseUrl) {
    throw new Error(
      "TWENTY_BASE_URL is not set. Set it to your Twenty instance URL, e.g. https://crm.example.com",
    );
  }
  if (!apiKey) {
    throw new Error(
      "TWENTY_API_KEY is not set. Create an API key in Twenty under Settings > APIs & Webhooks.",
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: env config loading and validation"
```

---

### Task 3: Twenty API error type and drift detection

**Files:**
- Create: `src/twenty/errors.ts`
- Create: `src/twenty/errors.test.ts`

**Interfaces:**
- Produces:
  - `class TwentyApiError extends Error` with `status: number`, `body: unknown`, `url: string`.
  - `function isSchemaDriftError(status: number, body: unknown): boolean` — true for 404 (unknown object/path) and 400 responses whose body text mentions an unknown field/column/object.
  - `function driftHint(objectName: string): string` — the standard message tail naming `refresh_schema`.

- [ ] **Step 1: Write the failing test `src/twenty/errors.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import {
  TwentyApiError,
  isSchemaDriftError,
  driftHint,
} from "./errors.js";

describe("TwentyApiError", () => {
  it("carries status, body, and url", () => {
    const e = new TwentyApiError("boom", 404, { messages: ["not found"] }, "/rest/widgets");
    expect(e.status).toBe(404);
    expect(e.url).toBe("/rest/widgets");
    expect(e.body).toEqual({ messages: ["not found"] });
  });
});

describe("isSchemaDriftError", () => {
  it("treats 404 as drift", () => {
    expect(isSchemaDriftError(404, {})).toBe(true);
  });

  it("treats a 400 mentioning an unknown field as drift", () => {
    expect(
      isSchemaDriftError(400, { messages: ['Field "foo" does not exist on object'] }),
    ).toBe(true);
  });

  it("does not treat a generic 400 as drift", () => {
    expect(isSchemaDriftError(400, { messages: ["value too long"] })).toBe(false);
  });

  it("does not treat 401 as drift", () => {
    expect(isSchemaDriftError(401, {})).toBe(false);
  });
});

describe("driftHint", () => {
  it("names refresh_schema and the object", () => {
    expect(driftHint("widgets")).toMatch(/refresh_schema/);
    expect(driftHint("widgets")).toMatch(/widgets/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/twenty/errors.test.ts`
Expected: FAIL — cannot resolve `./errors.js`.

- [ ] **Step 3: Implement `src/twenty/errors.ts`**

```typescript
export class TwentyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly url: string,
  ) {
    super(message);
    this.name = "TwentyApiError";
  }
}

const DRIFT_PATTERNS = [
  /does not exist/i,
  /unknown (field|column|object)/i,
  /no such (field|column|object)/i,
  /cannot find object/i,
];

export function isSchemaDriftError(status: number, body: unknown): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  const text = JSON.stringify(body ?? "");
  return DRIFT_PATTERNS.some((p) => p.test(text));
}

export function driftHint(objectName: string): string {
  return (
    ` This may mean the schema for "${objectName}" changed in Twenty. ` +
    `Call refresh_schema to reload the live schema, then retry.`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/twenty/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: Twenty API error type and schema-drift detection"
```

---

### Task 4: REST client

**Files:**
- Create: `src/twenty/restClient.ts`
- Create: `src/twenty/restClient.test.ts`

**Interfaces:**
- Consumes: `TwentyConfig` (Task 2), `TwentyApiError` (Task 3).
- Produces:
  - `class RestClient` constructed with `(config: TwentyConfig, fetchImpl?: typeof fetch)`.
  - `get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown>`
  - `post(path: string, body: unknown): Promise<unknown>`
  - `patch(path: string, body: unknown): Promise<unknown>`
  - `del(path: string): Promise<unknown>`
  - All prepend `config.baseUrl`, set the `Authorization` and `Content-Type` headers, drop `undefined` query values, and throw `TwentyApiError` on non-2xx. `path` is expected to start with `/rest`.

- [ ] **Step 1: Write the failing test `src/twenty/restClient.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { RestClient } from "./restClient.js";
import { TwentyApiError } from "./errors.js";

const cfg = { baseUrl: "https://crm.example.com", apiKey: "k" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("RestClient", () => {
  it("builds the URL, sets auth header, and returns parsed JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: { people: [] } }));
    const client = new RestClient(cfg, fetchImpl as unknown as typeof fetch);

    const result = await client.get("/rest/people", { limit: 10, cursor: undefined });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://crm.example.com/rest/people?limit=10");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(result).toEqual({ data: { people: [] } });
  });

  it("throws TwentyApiError with status and body on non-2xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { messages: ["not found"] }));
    const client = new RestClient(cfg, fetchImpl as unknown as typeof fetch);

    await expect(client.get("/rest/widgets")).rejects.toMatchObject({
      status: 404,
      body: { messages: ["not found"] },
    } satisfies Partial<TwentyApiError>);
  });

  it("sends a JSON body on post", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { data: {} }));
    const client = new RestClient(cfg, fetchImpl as unknown as typeof fetch);

    await client.post("/rest/people", { name: "Ada" });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Ada" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/twenty/restClient.test.ts`
Expected: FAIL — cannot resolve `./restClient.js`.

- [ ] **Step 3: Implement `src/twenty/restClient.ts`**

```typescript
import type { TwentyConfig } from "../config.js";
import { TwentyApiError } from "./errors.js";

type Query = Record<string, string | number | undefined>;

export class RestClient {
  constructor(
    private readonly config: TwentyConfig,
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
    const url = new URL(this.config.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    const res = await this.fetchImpl(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/twenty/restClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: REST client with auth and error mapping"
```

---

### Task 5: Schema types and metadata normalization

**Files:**
- Create: `src/schema/types.ts`
- Create: `src/schema/metadata.ts`
- Create: `src/schema/metadata.test.ts`
- Create: `tests/fixtures/metadata-objects.json`

**Interfaces:**
- Consumes: `RestClient` (Task 4).
- Produces:
  - Types: `interface FieldSchema { name: string; type: string; isNullable: boolean; isUnique: boolean; isActive: boolean; isSystem: boolean }` and `interface ObjectSchema { nameSingular: string; namePlural: string; labelSingular: string; labelPlural: string; isActive: boolean; isSystem: boolean; isSearchable: boolean; fields: FieldSchema[] }`.
  - `async function fetchAllObjects(rest: RestClient): Promise<ObjectSchema[]>` — calls `GET /rest/metadata/objects`, follows cursor pagination via `pageInfo`/`starting_after` until exhausted, and normalizes to `ObjectSchema[]` keeping only `isActive` objects and `isActive` fields.

- [ ] **Step 1: Create `tests/fixtures/metadata-objects.json`** (trimmed real shape, two pages)

```json
{
  "page1": {
    "data": [
      {
        "nameSingular": "company",
        "namePlural": "companies",
        "labelSingular": "Company",
        "labelPlural": "Companies",
        "isActive": true,
        "isSystem": false,
        "isSearchable": true,
        "fields": [
          { "name": "name", "type": "TEXT", "isNullable": false, "isUnique": false, "isActive": true, "isSystem": false },
          { "name": "deletedField", "type": "TEXT", "isNullable": true, "isUnique": false, "isActive": false, "isSystem": false }
        ]
      }
    ],
    "pageInfo": { "hasNextPage": true, "endCursor": "CURSOR_1" }
  },
  "page2": {
    "data": [
      {
        "nameSingular": "person",
        "namePlural": "people",
        "labelSingular": "Person",
        "labelPlural": "People",
        "isActive": true,
        "isSystem": false,
        "isSearchable": true,
        "fields": [
          { "name": "emails", "type": "EMAILS", "isNullable": true, "isUnique": false, "isActive": true, "isSystem": false }
        ]
      },
      {
        "nameSingular": "oldThing",
        "namePlural": "oldThings",
        "labelSingular": "Old thing",
        "labelPlural": "Old things",
        "isActive": false,
        "isSystem": false,
        "isSearchable": false,
        "fields": []
      }
    ],
    "pageInfo": { "hasNextPage": false, "endCursor": "CURSOR_2" }
  }
}
```

- [ ] **Step 2: Write the failing test `src/schema/metadata.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { fetchAllObjects } from "./metadata.js";
import fixtures from "../../tests/fixtures/metadata-objects.json";

function fakeRest(pages: unknown[]) {
  let call = 0;
  return {
    get: async () => pages[call++],
  } as unknown as import("../twenty/restClient.js").RestClient;
}

describe("fetchAllObjects", () => {
  it("paginates, drops inactive objects, and drops inactive fields", async () => {
    const rest = fakeRest([fixtures.page1, fixtures.page2]);
    const objects = await fetchAllObjects(rest);

    const names = objects.map((o) => o.namePlural).sort();
    expect(names).toEqual(["companies", "people"]); // oldThings dropped (inactive)

    const company = objects.find((o) => o.namePlural === "companies")!;
    expect(company.fields.map((f) => f.name)).toEqual(["name"]); // deletedField dropped
    expect(company.fields[0].type).toBe("TEXT");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/schema/metadata.test.ts`
Expected: FAIL — cannot resolve `./metadata.js`.

- [ ] **Step 4: Implement `src/schema/types.ts`**

```typescript
export interface FieldSchema {
  name: string;
  type: string;
  isNullable: boolean;
  isUnique: boolean;
  isActive: boolean;
  isSystem: boolean;
}

export interface ObjectSchema {
  nameSingular: string;
  namePlural: string;
  labelSingular: string;
  labelPlural: string;
  isActive: boolean;
  isSystem: boolean;
  isSearchable: boolean;
  fields: FieldSchema[];
}
```

- [ ] **Step 5: Implement `src/schema/metadata.ts`**

```typescript
import type { RestClient } from "../twenty/restClient.js";
import type { ObjectSchema, FieldSchema } from "./types.js";

interface RawField {
  name: string;
  type: string;
  isNullable?: boolean;
  isUnique?: boolean;
  isActive?: boolean;
  isSystem?: boolean;
}
interface RawObject {
  nameSingular: string;
  namePlural: string;
  labelSingular: string;
  labelPlural: string;
  isActive?: boolean;
  isSystem?: boolean;
  isSearchable?: boolean;
  fields: RawField[];
}
interface MetadataPage {
  data: RawObject[];
  pageInfo?: { hasNextPage?: boolean; endCursor?: string };
}

export async function fetchAllObjects(rest: RestClient): Promise<ObjectSchema[]> {
  const all: RawObject[] = [];
  let cursor: string | undefined;

  do {
    const page = (await rest.get("/rest/metadata/objects", {
      starting_after: cursor,
    })) as MetadataPage;
    all.push(...(page.data ?? []));
    cursor = page.pageInfo?.hasNextPage ? page.pageInfo.endCursor : undefined;
  } while (cursor);

  return all
    .filter((o) => o.isActive !== false)
    .map(normalizeObject);
}

function normalizeObject(o: RawObject): ObjectSchema {
  return {
    nameSingular: o.nameSingular,
    namePlural: o.namePlural,
    labelSingular: o.labelSingular,
    labelPlural: o.labelPlural,
    isActive: o.isActive !== false,
    isSystem: o.isSystem === true,
    isSearchable: o.isSearchable === true,
    fields: (o.fields ?? [])
      .filter((f) => f.isActive !== false)
      .map(normalizeField),
  };
}

function normalizeField(f: RawField): FieldSchema {
  return {
    name: f.name,
    type: f.type,
    isNullable: f.isNullable !== false,
    isUnique: f.isUnique === true,
    isActive: f.isActive !== false,
    isSystem: f.isSystem === true,
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test src/schema/metadata.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: metadata fetch + normalization into schema types"
```

---

### Task 6: Schema cache

**Files:**
- Create: `src/schema/cache.ts`
- Create: `src/schema/cache.test.ts`

**Interfaces:**
- Consumes: `RestClient` (Task 4), `fetchAllObjects` (Task 5), `ObjectSchema` (Task 5), `TwentyApiError`/`driftHint` (Task 3).
- Produces:
  - `class SchemaCache` constructed with `(rest: RestClient, loader?: typeof fetchAllObjects)`.
  - `async ensureLoaded(): Promise<void>` — loads once, lazily; concurrent calls share one in-flight promise.
  - `async refresh(): Promise<number>` — reloads, returns object count.
  - `list(): ObjectSchema[]`
  - `resolve(objectName: string): ObjectSchema` — matches `objectName` case-insensitively against `namePlural` or `nameSingular`; throws `Error` with `driftHint(objectName)` appended when not found.
  - `requireLoaded()` is implied by `resolve`/`list` calling state; if not loaded they throw "schema not loaded".

- [ ] **Step 1: Write the failing test `src/schema/cache.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { SchemaCache } from "./cache.js";
import type { ObjectSchema } from "./types.js";

const people: ObjectSchema = {
  nameSingular: "person", namePlural: "people",
  labelSingular: "Person", labelPlural: "People",
  isActive: true, isSystem: false, isSearchable: true,
  fields: [{ name: "name", type: "TEXT", isNullable: false, isUnique: false, isActive: true, isSystem: false }],
};

describe("SchemaCache", () => {
  it("loads lazily exactly once across concurrent ensureLoaded calls", async () => {
    const loader = vi.fn().mockResolvedValue([people]);
    const cache = new SchemaCache({} as any, loader);
    await Promise.all([cache.ensureLoaded(), cache.ensureLoaded()]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("resolves by plural or singular, case-insensitively", async () => {
    const cache = new SchemaCache({} as any, vi.fn().mockResolvedValue([people]));
    await cache.ensureLoaded();
    expect(cache.resolve("People").namePlural).toBe("people");
    expect(cache.resolve("person").namePlural).toBe("people");
  });

  it("throws a refresh_schema hint when object is unknown", async () => {
    const cache = new SchemaCache({} as any, vi.fn().mockResolvedValue([people]));
    await cache.ensureLoaded();
    expect(() => cache.resolve("widgets")).toThrow(/refresh_schema/);
  });

  it("refresh reloads and returns the count", async () => {
    const loader = vi.fn().mockResolvedValue([people]);
    const cache = new SchemaCache({} as any, loader);
    await cache.ensureLoaded();
    const n = await cache.refresh();
    expect(n).toBe(1);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/schema/cache.test.ts`
Expected: FAIL — cannot resolve `./cache.js`.

- [ ] **Step 3: Implement `src/schema/cache.ts`**

```typescript
import type { RestClient } from "../twenty/restClient.js";
import type { ObjectSchema } from "./types.js";
import { fetchAllObjects as defaultLoader } from "./metadata.js";
import { driftHint } from "../twenty/errors.js";

export class SchemaCache {
  private objects: ObjectSchema[] | null = null;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly rest: RestClient,
    private readonly loader: typeof defaultLoader = defaultLoader,
  ) {}

  async ensureLoaded(): Promise<void> {
    if (this.objects) return;
    if (!this.loading) {
      this.loading = this.loader(this.rest)
        .then((objs) => {
          this.objects = objs;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    await this.loading;
  }

  async refresh(): Promise<number> {
    this.objects = await this.loader(this.rest);
    return this.objects.length;
  }

  list(): ObjectSchema[] {
    return this.requireLoaded();
  }

  resolve(objectName: string): ObjectSchema {
    const objects = this.requireLoaded();
    const key = objectName.toLowerCase();
    const match = objects.find(
      (o) =>
        o.namePlural.toLowerCase() === key ||
        o.nameSingular.toLowerCase() === key,
    );
    if (!match) {
      throw new Error(`Unknown object "${objectName}".${driftHint(objectName)}`);
    }
    return match;
  }

  private requireLoaded(): ObjectSchema[] {
    if (!this.objects) {
      throw new Error("Schema not loaded. Call ensureLoaded() first.");
    }
    return this.objects;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/schema/cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: lazy-loading schema cache with object resolution"
```

---

### Task 7: Schema tools (list_object_types, describe_object, refresh_schema)

**Files:**
- Create: `src/tools/schemaTools.ts`
- Create: `src/tools/schemaTools.test.ts`

**Interfaces:**
- Consumes: `SchemaCache` (Task 6).
- Produces: `function schemaTools(cache: SchemaCache): ToolDef[]` where
  `interface ToolDef { name: string; description: string; inputSchema: z.ZodTypeAny; handler: (args: unknown) => Promise<string> }`.
  Define `ToolDef` here and export it; later tool modules import it. Each handler calls `cache.ensureLoaded()` first and returns a JSON string.
  - `list_object_types` → returns `[{ nameSingular, namePlural, labelPlural, isSystem }]`.
  - `describe_object` (input `{ object: string }`) → returns the resolved `ObjectSchema`.
  - `refresh_schema` (no input) → returns `{ refreshed: true, objectCount: n }`.

- [ ] **Step 1: Write the failing test `src/tools/schemaTools.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { schemaTools } from "./schemaTools.js";
import { SchemaCache } from "../schema/cache.js";
import type { ObjectSchema } from "../schema/types.js";

const people: ObjectSchema = {
  nameSingular: "person", namePlural: "people",
  labelSingular: "Person", labelPlural: "People",
  isActive: true, isSystem: false, isSearchable: true,
  fields: [{ name: "name", type: "TEXT", isNullable: false, isUnique: false, isActive: true, isSystem: false }],
};

function cacheWith(objs: ObjectSchema[]) {
  return new SchemaCache({} as any, vi.fn().mockResolvedValue(objs));
}
function tool(name: string, cache: SchemaCache) {
  return schemaTools(cache).find((t) => t.name === name)!;
}

describe("schemaTools", () => {
  it("list_object_types returns a compact object list", async () => {
    const out = JSON.parse(await tool("list_object_types", cacheWith([people])).handler({}));
    expect(out).toEqual([{ nameSingular: "person", namePlural: "people", labelPlural: "People", isSystem: false }]);
  });

  it("describe_object returns the full schema for a resolved object", async () => {
    const out = JSON.parse(await tool("describe_object", cacheWith([people])).handler({ object: "people" }));
    expect(out.namePlural).toBe("people");
    expect(out.fields[0].name).toBe("name");
  });

  it("refresh_schema reports the object count", async () => {
    const out = JSON.parse(await tool("refresh_schema", cacheWith([people])).handler({}));
    expect(out).toEqual({ refreshed: true, objectCount: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/tools/schemaTools.test.ts`
Expected: FAIL — cannot resolve `./schemaTools.js`.

- [ ] **Step 3: Implement `src/tools/schemaTools.ts`**

```typescript
import { z } from "zod";
import type { SchemaCache } from "../schema/cache.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<string>;
}

export function schemaTools(cache: SchemaCache): ToolDef[] {
  return [
    {
      name: "list_object_types",
      description:
        "List all available Twenty objects (built-in and custom). Use this first to discover what you can query.",
      inputSchema: z.object({}),
      handler: async () => {
        await cache.ensureLoaded();
        const list = cache.list().map((o) => ({
          nameSingular: o.nameSingular,
          namePlural: o.namePlural,
          labelPlural: o.labelPlural,
          isSystem: o.isSystem,
        }));
        return JSON.stringify(list);
      },
    },
    {
      name: "describe_object",
      description:
        "Return the fields, types, and metadata for one object. Call this before writing records so you use real field names.",
      inputSchema: z.object({ object: z.string() }),
      handler: async (args) => {
        const { object } = z.object({ object: z.string() }).parse(args);
        await cache.ensureLoaded();
        return JSON.stringify(cache.resolve(object));
      },
    },
    {
      name: "refresh_schema",
      description:
        "Reload the live Twenty schema. Call this after adding/changing objects or fields, or when a tool reports a schema mismatch.",
      inputSchema: z.object({}),
      handler: async () => {
        const objectCount = await cache.refresh();
        return JSON.stringify({ refreshed: true, objectCount });
      },
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/tools/schemaTools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: schema tools (list, describe, refresh)"
```

---

### Task 8: Read tools (query_records, get_record, search)

**Files:**
- Create: `src/tools/readTools.ts`
- Create: `src/tools/readTools.test.ts`

**Interfaces:**
- Consumes: `RestClient` (Task 4), `SchemaCache` (Task 6), `ToolDef` (Task 7), `TwentyApiError`/`isSchemaDriftError`/`driftHint` (Task 3).
- Produces: `function readTools(rest: RestClient, cache: SchemaCache): ToolDef[]`.
  - `query_records` (input `{ object, filter?, orderBy?, limit?, depth?, cursor? }`) → `GET /rest/{namePlural}` with those query params; returns the parsed body.
  - `get_record` (input `{ object, id }`) → `GET /rest/{namePlural}/{id}`.
  - `search` (input `{ query, limit? }`) → `GET /rest/search` with `q` and `limit` (Twenty global search). Returns parsed body.
  - All resolve the object via the cache, run inside a shared `withDriftHandling` helper that, on a `TwentyApiError` flagged by `isSchemaDriftError`, rethrows an `Error` whose message appends `driftHint(object)`.

- [ ] **Step 1: Write the failing test `src/tools/readTools.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { readTools } from "./readTools.js";
import { SchemaCache } from "../schema/cache.js";
import { TwentyApiError } from "../twenty/errors.js";
import type { ObjectSchema } from "../schema/types.js";

const people: ObjectSchema = {
  nameSingular: "person", namePlural: "people",
  labelSingular: "Person", labelPlural: "People",
  isActive: true, isSystem: false, isSearchable: true, fields: [],
};
function cache() {
  return new SchemaCache({} as any, vi.fn().mockResolvedValue([people]));
}
function tool(name: string, rest: any) {
  return readTools(rest, cache()).find((t) => t.name === name)!;
}

describe("readTools", () => {
  it("query_records builds GET on the plural path with query params", async () => {
    const rest = { get: vi.fn().mockResolvedValue({ data: { people: [] } }) };
    await tool("query_records", rest).handler({
      object: "people", filter: "name[eq]:Ada", limit: 5,
    });
    expect(rest.get).toHaveBeenCalledWith("/rest/people", {
      filter: "name[eq]:Ada", orderBy: undefined, limit: 5, depth: undefined, starting_after: undefined,
    });
  });

  it("get_record fetches by id", async () => {
    const rest = { get: vi.fn().mockResolvedValue({ data: { person: { id: "1" } } }) };
    await tool("get_record", rest).handler({ object: "people", id: "1" });
    expect(rest.get).toHaveBeenCalledWith("/rest/people/1");
  });

  it("maps a drift error into a refresh_schema hint", async () => {
    const rest = {
      get: vi.fn().mockRejectedValue(new TwentyApiError("x", 404, {}, "/rest/people")),
    };
    await expect(
      tool("query_records", rest).handler({ object: "people" }),
    ).rejects.toThrow(/refresh_schema/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/tools/readTools.test.ts`
Expected: FAIL — cannot resolve `./readTools.js`.

- [ ] **Step 3: Implement `src/tools/readTools.ts`**

```typescript
import { z } from "zod";
import type { RestClient } from "../twenty/restClient.js";
import type { SchemaCache } from "../schema/cache.js";
import type { ToolDef } from "./schemaTools.js";
import { TwentyApiError, isSchemaDriftError, driftHint } from "../twenty/errors.js";

async function withDriftHandling<T>(object: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TwentyApiError && isSchemaDriftError(err.status, err.body)) {
      throw new Error(`${err.message}.${driftHint(object)}`);
    }
    throw err;
  }
}

export function readTools(rest: RestClient, cache: SchemaCache): ToolDef[] {
  const queryShape = z.object({
    object: z.string(),
    filter: z.string().optional(),
    orderBy: z.string().optional(),
    limit: z.number().int().positive().max(60).optional(),
    depth: z.number().int().min(0).max(2).optional(),
    cursor: z.string().optional(),
  });

  return [
    {
      name: "query_records",
      description:
        "List records of one object with optional filter, orderBy, limit, depth (relations), and cursor pagination. Filter syntax: field[operator]:value, e.g. name[eq]:Acme.",
      inputSchema: queryShape,
      handler: async (args) => {
        const a = queryShape.parse(args);
        await cache.ensureLoaded();
        const obj = cache.resolve(a.object);
        return withDriftHandling(a.object, async () =>
          JSON.stringify(
            await rest.get(`/rest/${obj.namePlural}`, {
              filter: a.filter,
              orderBy: a.orderBy,
              limit: a.limit,
              depth: a.depth,
              starting_after: a.cursor,
            }),
          ),
        );
      },
    },
    {
      name: "get_record",
      description: "Fetch a single record by id.",
      inputSchema: z.object({ object: z.string(), id: z.string() }),
      handler: async (args) => {
        const a = z.object({ object: z.string(), id: z.string() }).parse(args);
        await cache.ensureLoaded();
        const obj = cache.resolve(a.object);
        return withDriftHandling(a.object, async () =>
          JSON.stringify(await rest.get(`/rest/${obj.namePlural}/${a.id}`)),
        );
      },
    },
    {
      name: "search",
      description: "Full-text search across searchable objects in Twenty.",
      inputSchema: z.object({ query: z.string(), limit: z.number().int().positive().max(60).optional() }),
      handler: async (args) => {
        const a = z
          .object({ query: z.string(), limit: z.number().int().positive().max(60).optional() })
          .parse(args);
        return JSON.stringify(await rest.get("/rest/search", { q: a.query, limit: a.limit }));
      },
    },
  ];
}
```

NOTE: the exact `search` path/params (`/rest/search?q=`) is the least-certain REST shape. Task 13 (integration smoke test) verifies it against the live instance; if it differs, adjust this handler and its unit test together.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/tools/readTools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: read tools (query_records, get_record, search)"
```

---

### Task 9: Write tools (create_records, update_records, delete_records)

**Files:**
- Create: `src/tools/writeTools.ts`
- Create: `src/tools/writeTools.test.ts`

**Interfaces:**
- Consumes: `RestClient` (Task 4), `SchemaCache` (Task 6), `ToolDef` (Task 7), drift helpers (Task 3).
- Produces: `function writeTools(rest: RestClient, cache: SchemaCache): ToolDef[]`.
  - `create_records` (input `{ object, records: object[] (1..60) }`) → `POST /rest/batch/{namePlural}` with the array.
  - `update_records` (input `{ object, records: {id: string}[] (1..60) }`) → one `PATCH /rest/{namePlural}/{id}` per record, results collected; each record must include `id`.
  - `delete_records` (input `{ object, ids: string[] (1..60) }`) → one `DELETE /rest/{namePlural}/{id}` per id, results collected.
  - All resolve via the cache and use the same drift handling as Task 8 (extract `withDriftHandling` into `src/tools/helpers.ts` so read and write tools share it).

- [ ] **Step 1: Extract the shared helper into `src/tools/helpers.ts`**

```typescript
import { TwentyApiError, isSchemaDriftError, driftHint } from "../twenty/errors.js";

export async function withDriftHandling<T>(object: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TwentyApiError && isSchemaDriftError(err.status, err.body)) {
      throw new Error(`${err.message}.${driftHint(object)}`);
    }
    throw err;
  }
}
```

Then update `src/tools/readTools.ts` to import `withDriftHandling` from `./helpers.js` and delete its local copy. Run `pnpm test src/tools/readTools.test.ts` to confirm still green.

- [ ] **Step 2: Write the failing test `src/tools/writeTools.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { writeTools } from "./writeTools.js";
import { SchemaCache } from "../schema/cache.js";
import type { ObjectSchema } from "../schema/types.js";

const people: ObjectSchema = {
  nameSingular: "person", namePlural: "people",
  labelSingular: "Person", labelPlural: "People",
  isActive: true, isSystem: false, isSearchable: true, fields: [],
};
function cache() {
  return new SchemaCache({} as any, vi.fn().mockResolvedValue([people]));
}
function tool(name: string, rest: any) {
  return writeTools(rest, cache()).find((t) => t.name === name)!;
}

describe("writeTools", () => {
  it("create_records POSTs the array to the batch path", async () => {
    const rest = { post: vi.fn().mockResolvedValue({ data: { createPeople: [] } }) };
    await tool("create_records", rest).handler({ object: "people", records: [{ name: "Ada" }] });
    expect(rest.post).toHaveBeenCalledWith("/rest/batch/people", [{ name: "Ada" }]);
  });

  it("update_records PATCHes each record by id", async () => {
    const rest = { patch: vi.fn().mockResolvedValue({ data: {} }) };
    await tool("update_records", rest).handler({
      object: "people",
      records: [{ id: "1", name: "A" }, { id: "2", name: "B" }],
    });
    expect(rest.patch).toHaveBeenNthCalledWith(1, "/rest/people/1", { name: "A" });
    expect(rest.patch).toHaveBeenNthCalledWith(2, "/rest/people/2", { name: "B" });
  });

  it("update_records rejects a record without an id", async () => {
    const rest = { patch: vi.fn() };
    await expect(
      tool("update_records", rest).handler({ object: "people", records: [{ name: "A" }] }),
    ).rejects.toThrow(/id/);
  });

  it("delete_records DELETEs each id", async () => {
    const rest = { del: vi.fn().mockResolvedValue({ data: {} }) };
    await tool("delete_records", rest).handler({ object: "people", ids: ["1", "2"] });
    expect(rest.del).toHaveBeenNthCalledWith(1, "/rest/people/1");
    expect(rest.del).toHaveBeenNthCalledWith(2, "/rest/people/2");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/tools/writeTools.test.ts`
Expected: FAIL — cannot resolve `./writeTools.js`.

- [ ] **Step 4: Implement `src/tools/writeTools.ts`**

```typescript
import { z } from "zod";
import type { RestClient } from "../twenty/restClient.js";
import type { SchemaCache } from "../schema/cache.js";
import type { ToolDef } from "./schemaTools.js";
import { withDriftHandling } from "./helpers.js";

const recordArray = z.array(z.record(z.string(), z.unknown())).min(1).max(60);

export function writeTools(rest: RestClient, cache: SchemaCache): ToolDef[] {
  return [
    {
      name: "create_records",
      description: "Create 1–60 records of one object in a single batch.",
      inputSchema: z.object({ object: z.string(), records: recordArray }),
      handler: async (args) => {
        const a = z.object({ object: z.string(), records: recordArray }).parse(args);
        await cache.ensureLoaded();
        const obj = cache.resolve(a.object);
        return withDriftHandling(a.object, async () =>
          JSON.stringify(await rest.post(`/rest/batch/${obj.namePlural}`, a.records)),
        );
      },
    },
    {
      name: "update_records",
      description: "Update 1–60 records of one object. Each record MUST include its id.",
      inputSchema: z.object({ object: z.string(), records: recordArray }),
      handler: async (args) => {
        const a = z.object({ object: z.string(), records: recordArray }).parse(args);
        await cache.ensureLoaded();
        const obj = cache.resolve(a.object);
        return withDriftHandling(a.object, async () => {
          const results = [];
          for (const record of a.records) {
            const { id, ...rest_ } = record as { id?: string };
            if (!id) throw new Error("Each record in update_records must include an id.");
            results.push(await rest.patch(`/rest/${obj.namePlural}/${id}`, rest_));
          }
          return JSON.stringify(results);
        });
      },
    },
    {
      name: "delete_records",
      description: "Delete 1–60 records of one object by id.",
      inputSchema: z.object({ object: z.string(), ids: z.array(z.string()).min(1).max(60) }),
      handler: async (args) => {
        const a = z
          .object({ object: z.string(), ids: z.array(z.string()).min(1).max(60) })
          .parse(args);
        await cache.ensureLoaded();
        const obj = cache.resolve(a.object);
        return withDriftHandling(a.object, async () => {
          const results = [];
          for (const id of a.ids) {
            results.push(await rest.del(`/rest/${obj.namePlural}/${id}`));
          }
          return JSON.stringify(results);
        });
      },
    },
  ];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/tools/writeTools.test.ts src/tools/readTools.test.ts`
Expected: PASS (both files).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: batch write tools (create, update, delete) + shared drift helper"
```

---

### Task 10: GraphQL client + upsert_records

**Files:**
- Create: `src/twenty/graphqlClient.ts`
- Create: `src/twenty/graphqlClient.test.ts`
- Create: `src/tools/upsertTool.ts`
- Create: `src/tools/upsertTool.test.ts`

**Interfaces:**
- Consumes: `TwentyConfig` (Task 2), `TwentyApiError` (Task 3), `SchemaCache` (Task 6), `ToolDef` (Task 7), `withDriftHandling` (Task 9).
- Produces:
  - `class GraphQLClient` constructed with `(config: TwentyConfig, fetchImpl?: typeof fetch)`; method `request(query: string, variables: Record<string, unknown>): Promise<unknown>` POSTs to `/graphql`, throws `TwentyApiError` on transport non-2xx and on a GraphQL `errors` array.
  - `upsertTool(gql: GraphQLClient, cache: SchemaCache): ToolDef` exposing `upsert_records` (input `{ object, records: object[] (1..60) }`). It builds the plural upsert mutation named from the object's `labelPlural`/`namePlural` (Twenty mutation `create<NamePluralPascalCase>` with `upsert: true`) and returns ids. The exact mutation name casing and the `upsert` argument are verified by Task 13 against the live instance; keep the mutation-name builder in one small exported function `upsertMutationName(namePlural: string): string` so the verified form is changed in exactly one place.

- [ ] **Step 1: Write the failing test `src/twenty/graphqlClient.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { GraphQLClient } from "./graphqlClient.js";

const cfg = { baseUrl: "https://crm.example.com", apiKey: "k" };
function res(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("GraphQLClient", () => {
  it("POSTs to /graphql with auth and returns data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, { data: { ok: true } }));
    const client = new GraphQLClient(cfg, fetchImpl as unknown as typeof fetch);
    const out = await client.request("query { x }", { a: 1 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://crm.example.com/graphql");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string)).toEqual({ query: "query { x }", variables: { a: 1 } });
    expect(out).toEqual({ ok: true });
  });

  it("throws when the response contains GraphQL errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, { errors: [{ message: "bad" }] }));
    const client = new GraphQLClient(cfg, fetchImpl as unknown as typeof fetch);
    await expect(client.request("q", {})).rejects.toMatchObject({ status: 200 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/twenty/graphqlClient.test.ts`
Expected: FAIL — cannot resolve `./graphqlClient.js`.

- [ ] **Step 3: Implement `src/twenty/graphqlClient.ts`**

```typescript
import type { TwentyConfig } from "../config.js";
import { TwentyApiError } from "./errors.js";

export class GraphQLClient {
  constructor(
    private readonly config: TwentyConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const url = `${this.config.baseUrl}/graphql`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new TwentyApiError(`Twenty GraphQL failed (${res.status})`, res.status, parsed, url);
    }
    if (parsed.errors) {
      throw new TwentyApiError("Twenty GraphQL returned errors", res.status, parsed.errors, url);
    }
    return parsed.data;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/twenty/graphqlClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test `src/tools/upsertTool.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { upsertTool, upsertMutationName } from "./upsertTool.js";
import { SchemaCache } from "../schema/cache.js";
import type { ObjectSchema } from "../schema/types.js";

const people: ObjectSchema = {
  nameSingular: "person", namePlural: "people",
  labelSingular: "Person", labelPlural: "People",
  isActive: true, isSystem: false, isSearchable: true, fields: [],
};
function cache() {
  return new SchemaCache({} as any, vi.fn().mockResolvedValue([people]));
}

describe("upsertMutationName", () => {
  it("builds a PascalCase plural create mutation name", () => {
    expect(upsertMutationName("people")).toBe("createPeople");
    expect(upsertMutationName("companyDeals")).toBe("createCompanyDeals");
  });
});

describe("upsert_records", () => {
  it("calls GraphQL with the upsert mutation and record data", async () => {
    const gql = { request: vi.fn().mockResolvedValue({ createPeople: [{ id: "1" }] }) };
    const tool = upsertTool(gql as any, cache());
    const out = JSON.parse(await tool.handler({ object: "people", records: [{ id: "1", name: "Ada" }] }));
    expect(gql.request).toHaveBeenCalledTimes(1);
    const [query, variables] = gql.request.mock.calls[0];
    expect(query).toContain("createPeople");
    expect(query).toContain("upsert: true");
    expect(variables).toEqual({ data: [{ id: "1", name: "Ada" }] });
    expect(out).toEqual([{ id: "1" }]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test src/tools/upsertTool.test.ts`
Expected: FAIL — cannot resolve `./upsertTool.js`.

- [ ] **Step 7: Implement `src/tools/upsertTool.ts`**

```typescript
import { z } from "zod";
import type { GraphQLClient } from "../twenty/graphqlClient.js";
import type { SchemaCache } from "../schema/cache.js";
import type { ToolDef } from "./schemaTools.js";
import { withDriftHandling } from "./helpers.js";

export function upsertMutationName(namePlural: string): string {
  return "create" + namePlural.charAt(0).toUpperCase() + namePlural.slice(1);
}

const shape = z.object({
  object: z.string(),
  records: z.array(z.record(z.string(), z.unknown())).min(1).max(60),
});

export function upsertTool(gql: GraphQLClient, cache: SchemaCache): ToolDef {
  return {
    name: "upsert_records",
    description:
      "Create-or-update 1–60 records of one object in a single call. Records with an existing id (or unique field match) are updated; others are created.",
    inputSchema: shape,
    handler: async (args) => {
      const a = shape.parse(args);
      await cache.ensureLoaded();
      const obj = cache.resolve(a.object);
      const mutationName = upsertMutationName(obj.namePlural);
      const query = `mutation Upsert($data: [${obj.labelSingular.replace(/\s+/g, "")}CreateInput!]!) {
  ${mutationName}(data: $data, upsert: true) { id }
}`;
      return withDriftHandling(a.object, async () => {
        const data = await gql.request(query, { data: a.records });
        return JSON.stringify((data as Record<string, unknown>)[mutationName]);
      });
    },
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm test src/tools/upsertTool.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: GraphQL client + upsert_records tool"
```

---

### Task 11: Schema resource + server wiring

**Files:**
- Modify: `src/index.ts` (full rewrite of the stub from Task 1)
- Create: `src/server.ts`
- Create: `src/server.test.ts`

**Interfaces:**
- Consumes: every tool factory (Tasks 7–10), `SchemaCache` (Task 6), `RestClient` (Task 4), `GraphQLClient` (Task 10), `loadConfig` (Task 2).
- Produces:
  - `function buildTools(rest, gql, cache): ToolDef[]` — concatenates schema/read/write tools + the upsert tool, asserts unique names, returns them.
  - `function createServer(config: TwentyConfig, fetchImpl?): { server: McpServer; cache: SchemaCache }` — constructs clients, cache, registers all tools and a `twenty://schema` resource that returns `JSON.stringify(cache.list())` after `ensureLoaded()`.
  - `src/index.ts` calls `loadConfig(process.env)`, `createServer`, connects a `StdioServerTransport`.

- [ ] **Step 1: Write the failing test `src/server.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildTools } from "./server.js";
import { RestClient } from "./twenty/restClient.js";
import { GraphQLClient } from "./twenty/graphqlClient.js";
import { SchemaCache } from "./schema/cache.js";

const cfg = { baseUrl: "https://x", apiKey: "k" };

describe("buildTools", () => {
  it("exposes the full unique tool set", () => {
    const rest = new RestClient(cfg, vi.fn() as unknown as typeof fetch);
    const gql = new GraphQLClient(cfg, vi.fn() as unknown as typeof fetch);
    const cache = new SchemaCache(rest, vi.fn().mockResolvedValue([]));
    const names = buildTools(rest, gql, cache).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "create_records", "delete_records", "describe_object", "get_record",
        "list_object_types", "query_records", "refresh_schema", "search",
        "update_records", "upsert_records",
      ].sort(),
    );
    expect(new Set(names).size).toBe(names.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/server.test.ts`
Expected: FAIL — cannot resolve `./server.js`.

- [ ] **Step 3: Implement `src/server.ts`** (verify exact SDK registration API against `@modelcontextprotocol/sdk` docs via Context7 before writing; the shape below matches the current high-level `McpServer` API)

```typescript
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TwentyConfig } from "./config.js";
import { RestClient } from "./twenty/restClient.js";
import { GraphQLClient } from "./twenty/graphqlClient.js";
import { SchemaCache } from "./schema/cache.js";
import { schemaTools, type ToolDef } from "./tools/schemaTools.js";
import { readTools } from "./tools/readTools.js";
import { writeTools } from "./tools/writeTools.js";
import { upsertTool } from "./tools/upsertTool.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

export function buildTools(
  rest: RestClient,
  gql: GraphQLClient,
  cache: SchemaCache,
): ToolDef[] {
  const tools = [
    ...schemaTools(cache),
    ...readTools(rest, cache),
    ...writeTools(rest, cache),
    upsertTool(gql, cache),
  ];
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) throw new Error(`Duplicate tool name: ${t.name}`);
    seen.add(t.name);
  }
  return tools;
}

export function createServer(config: TwentyConfig, fetchImpl: typeof fetch = fetch) {
  const rest = new RestClient(config, fetchImpl);
  const gql = new GraphQLClient(config, fetchImpl);
  const cache = new SchemaCache(rest);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const tool of buildTools(rest, gql, cache)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: (tool.inputSchema as any).shape ?? {} },
      async (args: unknown) => {
        const text = await tool.handler(args);
        return { content: [{ type: "text", text }] };
      },
    );
  }

  server.registerResource(
    "schema",
    "twenty://schema",
    { description: "The live Twenty schema (objects and fields) as JSON." },
    async () => {
      await cache.ensureLoaded();
      return {
        contents: [
          { uri: "twenty://schema", mimeType: "application/json", text: JSON.stringify(cache.list()) },
        ],
      };
    },
  );

  return { server, cache };
}
```

- [ ] **Step 4: Rewrite `src/index.ts`**

```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const { server } = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 5: Run test + build to verify both pass**

Run: `pnpm test src/server.test.ts && pnpm build`
Expected: test PASS; build emits `dist/index.js`.

- [ ] **Step 6: Smoke-test the binary starts and lists tools over stdio**

Run: `TWENTY_BASE_URL=https://example.com TWENTY_API_KEY=test node dist/index.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
EOF`
Expected: a JSON-RPC response listing 10 tools (no Twenty call is made because the cache is lazy).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wire MCP server, tools, and schema resource over stdio"
```

---

### Task 12: Companion Skill

**Files:**
- Create: `skill/twenty-crm/SKILL.md`

**Interfaces:**
- Consumes: nothing at runtime; documents the tools from Tasks 7–10.
- Produces: an installable Claude Code Skill.

- [ ] **Step 1: Write `skill/twenty-crm/SKILL.md`**

```markdown
---
name: twenty-crm
description: Use when interacting with Twenty CRM through the twentycrm-mcp server — querying, creating, updating, or upserting people, companies, notes, tasks, opportunities, or custom objects. Covers the filter syntax, the describe-before-write discipline, batch/upsert guidance, and the refresh_schema recovery reflex.
---

# Working with Twenty CRM

This server is metadata-driven: object and field names come from your live Twenty schema, not hardcoded. Object names are passed as a parameter to every tool.

## Always do this first
1. Call `list_object_types` to see what objects exist (built-in and custom).
2. Before writing, call `describe_object` for the target object to use real field names and types. Do not guess field names — Twenty rejects unknown fields.

## Filter syntax (query_records)
- Format: `field[operator]:value`, e.g. `name[eq]:Acme`, `createdAt[gt]:2026-01-01`.
- Operators by field type: TEXT → eq, contains (use the documented operator names from `describe_object` types); NUMBER → eq, gt, lt, gte, lte; DATE_TIME → before/after/eq; BOOLEAN → is; relations → eq, isEmpty.
- Combine conditions with `and`/`or` per Twenty's filter grammar.
- Use `orderBy` like `createdAt[DescNullsLast]`, `limit` (max 60), `depth` (0–2) to include related records, and `cursor` for pagination.

## Writing records
- All write tools are batch-native: pass an array of 1–60 records, even for a single write.
- `create_records` — new records.
- `update_records` — each record MUST include its `id`.
- `delete_records` — pass an array of ids.
- `upsert_records` — create-or-update in one call; records with a matching id/unique field are updated, others created. Prefer this for idempotent imports.

## Recipes
- Find a person by email, then attach a note:
  1. `query_records` object=people, filter=`emails.primaryEmail[eq]:a@b.com`.
  2. `create_records` object=notes with the note body, then link via the note's relation field to the person id (check the relation field name with `describe_object`).
- Link a record to a company: set the relation field (e.g. `companyId`) to the company's id; confirm the exact field name via `describe_object`.

## When something fails with a schema mismatch
If a tool reports "Unknown object" or a field error mentioning `refresh_schema`, the schema changed since the server cached it. Call `refresh_schema`, then retry. This is the normal recovery path after you add a custom object or field in Twenty.
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "docs: companion Twenty CRM skill"
```

---

### Task 13: Integration smoke test (env-gated, source of truth for wire formats)

**Files:**
- Create: `vitest.integration.config.ts`
- Create: `tests/integration/live.test.ts`
- Create: `docs/twenty-api-contract.md`

**Interfaces:**
- Consumes: `loadConfig`, `RestClient`, `GraphQLClient`, `SchemaCache`, all tool factories.
- Produces: a test suite that runs ONLY when `TWENTY_BASE_URL` and `TWENTY_API_KEY` are set, verifying the real wire formats and recording them in `docs/twenty-api-contract.md`. This is where the three spec "open items" (search path, upsert mutation shape, metadata envelope) are confirmed against v2.17.2.

- [ ] **Step 1: Create `vitest.integration.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/integration/**/*.test.ts"], environment: "node", testTimeout: 30000 },
});
```

- [ ] **Step 2: Write `tests/integration/live.test.ts`**

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { loadConfig } from "../../src/config.js";
import { RestClient } from "../../src/twenty/restClient.js";
import { SchemaCache } from "../../src/schema/cache.js";

const hasEnv = !!(process.env.TWENTY_BASE_URL && process.env.TWENTY_API_KEY);
const maybe = hasEnv ? describe : describe.skip;

maybe("live Twenty instance", () => {
  let rest: RestClient;
  let cache: SchemaCache;

  beforeAll(() => {
    const cfg = loadConfig(process.env);
    rest = new RestClient(cfg);
    cache = new SchemaCache(rest);
  });

  it("loads the schema and finds the people object", async () => {
    await cache.ensureLoaded();
    const people = cache.resolve("people");
    expect(people.namePlural).toBe("people");
    expect(people.fields.length).toBeGreaterThan(0);
  });

  it("query_records returns a list envelope for people", async () => {
    const body = (await rest.get("/rest/people", { limit: 1 })) as Record<string, unknown>;
    // Record the real envelope shape in docs/twenty-api-contract.md.
    expect(body).toHaveProperty("data");
  });

  it("confirms the search endpoint shape", async () => {
    const body = await rest.get("/rest/search", { q: "a", limit: 1 });
    expect(body).toBeDefined();
  });
});
```

- [ ] **Step 3: Run the integration suite against the live instance**

Run: `TWENTY_BASE_URL=… TWENTY_API_KEY=… ppnpm test:integration`
Expected: PASS. If `search` or any envelope differs from assumptions in Tasks 8/10, fix the corresponding handler + its unit test, then re-run.

- [ ] **Step 4: Record findings in `docs/twenty-api-contract.md`**

Document the real, observed shapes for: metadata objects envelope + pagination, list/get/create/update/delete REST responses, the search endpoint path and response, and the working upsert mutation (name casing + `upsert` argument). One short section each, with a trimmed real example (no PII).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: env-gated live integration suite + verified API contract doc"
```

---

### Task 14: README and publish prep

**Files:**
- Create: `README.md`
- Modify: `package.json` (confirm `repository`, `keywords`, `license`, `author`)
- Create: `LICENSE` (MIT)

**Interfaces:**
- Consumes: the finished server + skill.
- Produces: install/usage docs and npm-publishable metadata.

- [ ] **Step 1: Write `README.md`** with: one-paragraph pitch (version-resilient, metadata-driven), the resilience model (tools = mechanism, Skill = knowledge, `refresh_schema` for drift), quickstart (`npx twentycrm-mcp` with the two env vars), a Claude Code `mcpServers` config snippet pointing at `npx`, the full tool list with one-line descriptions, Skill install instructions (copy `skill/twenty-crm` into `.claude/skills/`), and a "supported Twenty versions" note (validated against v2.17.2).

- [ ] **Step 2: Add `LICENSE`** (MIT, author "Andrew / Five59 Labs").

- [ ] **Step 3: Fill `package.json` metadata** — `"license": "MIT"`, `"author"`, `"repository"`, `"keywords": ["mcp", "twenty", "crm", "model-context-protocol"]`.

- [ ] **Step 4: Final full test + build**

Run: `pnpm test && pnpm build`
Expected: all unit tests PASS; build emits `dist/index.js`.

- [ ] **Step 5: Verify the published file list**

Run: `pnpm pack` then inspect with `tar -tzf twentycrm-mcp-*.tgz` (delete the tarball after).
Expected: tarball includes `dist/`, `skill/`, `README.md`, `LICENSE` — and NOT `.env`, `tests/`, or `src/`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: README, license, and npm publish metadata"
```

---

## Self-Review

**Spec coverage:**
- Resilience via metadata-driven schema cache → Tasks 5, 6 (cache), used by all tools. ✓
- Lazy load on first call → Task 6 `ensureLoaded`. ✓
- `refresh_schema` tool + manual drift handling naming it → Tasks 3 (hint), 6, 7, 8/9 (drift wrap). ✓
- Schema-as-resource → Task 11. ✓
- REST-first CRUD + Metadata API → Tasks 4, 5, 8, 9. ✓
- GraphQL only for upsert → Task 10. ✓
- Batch-native writes (1–60) → Task 9 (arrays), Task 10 (upsert). ✓
- ~10 tools incl. search → Tasks 7–10, asserted in Task 11. ✓
- Companion Skill → Task 12. ✓
- TDD + mocked Twenty; env-gated integration tests → throughout; Task 13. ✓
- TypeScript, MCP SDK, stdio, npx, env config → Tasks 1, 2, 11, 14. ✓
- Three open items (search shape, upsert mutation, metadata envelope) → Task 13 resolves and documents. ✓

**Placeholder scan:** No "TBD"/"implement later". Two explicitly-flagged uncertainties (search path in Task 8, upsert mutation casing in Task 10) are isolated behind single functions and verified in Task 13 — these are real, tested deliverables, not placeholders.

**Type consistency:** `ToolDef` defined once (Task 7), imported everywhere. `withDriftHandling` defined once (Task 9 helpers), read tools refactored to it. `SchemaCache`/`ObjectSchema`/`FieldSchema` names consistent across Tasks 5–11. Tool names in Task 11's assertion match the names defined in Tasks 7–10.
