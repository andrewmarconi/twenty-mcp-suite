# Twenty Suite — Plan 3a: Capability Profiles + Curated CRM Segment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the generic 10-tool server into a *curated, role-scoped* CRM segment by introducing capability profiles — a profile scopes which Twenty objects are reachable and exposes a compact, business-named tool set, all as configuration over the existing generic primitives (no schema hardcoded in code).

**Architecture:** A `CapabilityProfile` (a typed TS literal) declares an `objectScope` and a list of tool specs (which primitive to expose, an optional alias, and optional bound arguments). `buildProfileTools` transforms the generic primitive `ToolDef[]` into the curated set: it aliases/binds tools, omits bound args from the exposed schema, and wraps every handler to refuse out-of-scope objects (resolved against the live schema). A new `createSegmentServer(connection, profile, meta)` wires those tools plus a scope-filtered `twenty://schema` resource. The CRM segment ships one such profile; `expand`, recipes/composites, and audit are Plan 3b.

**Tech Stack:** TypeScript ESM, zod v4, `@modelcontextprotocol/sdk`, vitest. **No new dependencies.**

## Global Constraints

- Node `>=20`; ESM only; **`.js` import extensions** on local imports.
- Package manager **pnpm**; this plan adds **no dependencies**.
- **stdout is reserved for the MCP server**; diagnostics to `console.error`.
- **No object or field name is hardcoded in a way that breaks resilience.** A profile *names* objects (e.g. `"people"`) but every reference resolves against the **live schema** at runtime via the existing `SchemaCache`; an object that no longer exists surfaces the normal drift/unknown-object error. This is configuration, not compiled schema knowledge.
- **Profiles are typed TS literals**, compile-checked and unit-tested, bundled by tsup. (User-editable JSON overrides are a deferred future extension behind the same builder.)
- **Behavior-preserving for the generic path:** `createServer` (all-tools) and `buildTools` keep their current behavior and tests; the curated path is additive via `createSegmentServer`.
- **Deferred to later cycles (do NOT build here):** the `expand` primitive, recipe runner + composites (`get_contact_brief`), audit logging, `readOnly`/`expectedRole` profile fields, the in-session `switch_connection` tool.

## File Structure

- `packages/twenty-core/src/profile/types.ts` — `CapabilityProfile`, `ProfileToolSpec` (new).
- `packages/twenty-core/src/profile/buildProfileTools.ts` — the profile→tools transformer + scope enforcement (new).
- `packages/twenty-core/src/profile/buildProfileTools.test.ts` — unit tests (new).
- `packages/twenty-core/src/server.ts` — extract a private `wireServer`, add `createSegmentServer` (modify).
- `packages/twenty-core/src/index.ts` — barrel exports (modify).
- `packages/twenty-crm-mcp/src/profile.ts` — the CRM `CapabilityProfile` literal (new).
- `packages/twenty-crm-mcp/src/profile.test.ts` — CRM profile shape test (new).
- `packages/twenty-crm-mcp/src/index.ts` — use `createSegmentServer` + `crmProfile` (modify).

---

### Task 1: Capability profile type + `buildProfileTools`

**Files:**
- Create: `packages/twenty-core/src/profile/types.ts`
- Create: `packages/twenty-core/src/profile/buildProfileTools.ts`
- Test: `packages/twenty-core/src/profile/buildProfileTools.test.ts`
- Modify: `packages/twenty-core/src/index.ts`

**Interfaces:**
- Consumes: `ToolDef` (`../tools/schemaTools.js`), `SchemaCache` (`../schema/cache.js`), `ObjectSchema` (`../schema/types.js`), `zod`.
- Produces:
  - `interface ProfileToolSpec { from: string; as?: string; bind?: Record<string, unknown>; description?: string }`
  - `interface CapabilityProfile { name: string; objectScope?: string[]; tools: ProfileToolSpec[] }`
  - `function buildProfileTools(profile: CapabilityProfile, primitives: ToolDef[], cache: SchemaCache): ToolDef[]` — resolves each spec against `primitives` (throws on unknown `from` or duplicate exposed name); for a spec with `bind`, omits the bound keys from the exposed `inputSchema` (the primitive schema must be a `z.ZodObject`) and merges the bound values into args before delegating; wraps every handler so that, when `objectScope` is set and the effective args contain a string `object`, it is resolved via the cache and refused if out of scope; `list_object_types` output is filtered to the scope.

- [ ] **Step 1: Write the failing test**

Create `packages/twenty-core/src/profile/buildProfileTools.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { buildProfileTools } from "./buildProfileTools.js";
import type { CapabilityProfile } from "./types.js";
import type { ToolDef } from "../tools/schemaTools.js";
import type { ObjectSchema } from "../schema/types.js";

const people: ObjectSchema = {
  nameSingular: "person", namePlural: "people",
  labelSingular: "Person", labelPlural: "People",
  isActive: true, isSystem: false, isSearchable: true, fields: [],
};
const workflows: ObjectSchema = {
  nameSingular: "workflow", namePlural: "workflows",
  labelSingular: "Workflow", labelPlural: "Workflows",
  isActive: true, isSystem: true, isSearchable: false, fields: [],
};

// Fake cache: resolve() maps singular/plural to the object; throws for unknown.
function fakeCache() {
  const all = [people, workflows];
  return {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    resolve: (name: string) => {
      const o = all.find(
        (x) => x.namePlural === name || x.nameSingular === name,
      );
      if (!o) throw new Error(`Unknown object "${name}".`);
      return o;
    },
  } as any;
}

// Fake primitives that echo the args they received.
function primitives(): ToolDef[] {
  return [
    {
      name: "query_records",
      description: "Generic query.",
      inputSchema: z.object({ object: z.string(), filter: z.string().optional() }),
      handler: async (a) => JSON.stringify({ tool: "query", args: a }),
    },
    {
      name: "list_object_types",
      description: "List objects.",
      inputSchema: z.object({}),
      handler: async () =>
        JSON.stringify([
          { nameSingular: "person", namePlural: "people" },
          { nameSingular: "workflow", namePlural: "workflows" },
        ]),
    },
    {
      name: "search",
      description: "Search.",
      inputSchema: z.object({ query: z.string() }),
      handler: async (a) => JSON.stringify({ tool: "search", args: a }),
    },
  ];
}

const profile: CapabilityProfile = {
  name: "crm",
  objectScope: ["people"],
  tools: [
    { from: "list_object_types" },
    { from: "query_records", as: "find_contacts", bind: { object: "people" }, description: "Find people." },
    { from: "query_records" },
    { from: "search" },
  ],
};

describe("buildProfileTools", () => {
  it("aliases a tool, omits bound args from its schema, and injects the binding", async () => {
    const tools = buildProfileTools(profile, primitives(), fakeCache());
    const findContacts = tools.find((t) => t.name === "find_contacts")!;
    expect(findContacts.description).toBe("Find people.");
    // `object` was bound, so it is omitted from the exposed schema:
    expect("object" in (findContacts.inputSchema as z.ZodObject<any>).shape).toBe(false);
    const out = JSON.parse(await findContacts.handler({ filter: "name[eq]:Ada" }));
    expect(out.args).toEqual({ filter: "name[eq]:Ada", object: "people" });
  });

  it("refuses an out-of-scope object on a generic tool", async () => {
    const tools = buildProfileTools(profile, primitives(), fakeCache());
    const query = tools.find((t) => t.name === "query_records")!;
    await expect(query.handler({ object: "workflows" })).rejects.toThrow(/not available in the "crm" profile/);
    // in-scope object passes:
    const ok = JSON.parse(await query.handler({ object: "people" }));
    expect(ok.tool).toBe("query");
  });

  it("filters list_object_types output to the scope", async () => {
    const tools = buildProfileTools(profile, primitives(), fakeCache());
    const list = tools.find((t) => t.name === "list_object_types")!;
    const out = JSON.parse(await list.handler({}));
    expect(out.map((o: { namePlural: string }) => o.namePlural)).toEqual(["people"]);
  });

  it("leaves a no-object tool (search) unscoped", async () => {
    const tools = buildProfileTools(profile, primitives(), fakeCache());
    const search = tools.find((t) => t.name === "search")!;
    const out = JSON.parse(await search.handler({ query: "acme" }));
    expect(out.tool).toBe("search");
  });

  it("throws on an unknown `from`", () => {
    const bad: CapabilityProfile = { name: "x", tools: [{ from: "nope" }] };
    expect(() => buildProfileTools(bad, primitives(), fakeCache())).toThrow(/unknown tool "nope"/);
  });

  it("throws on a duplicate exposed name", () => {
    const bad: CapabilityProfile = {
      name: "x",
      tools: [{ from: "search" }, { from: "query_records", as: "search" }],
    };
    expect(() => buildProfileTools(bad, primitives(), fakeCache())).toThrow(/duplicate tool name "search"/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter twenty-core test src/profile/buildProfileTools.test.ts`
Expected: FAIL — cannot resolve `./buildProfileTools.js` / `./types.js`.

- [ ] **Step 3: Write the types**

Create `packages/twenty-core/src/profile/types.ts`:

```ts
/** One exposed tool in a capability profile: which primitive, under what name, with what bound args. */
export interface ProfileToolSpec {
  from: string;
  as?: string;
  bind?: Record<string, unknown>;
  description?: string;
}

/** A role-scoped capability surface built over the generic primitives. */
export interface CapabilityProfile {
  name: string;
  /** Allowed object names (nameSingular or namePlural, case-insensitive). Undefined = all objects. */
  objectScope?: string[];
  tools: ProfileToolSpec[];
}
```

- [ ] **Step 4: Write the builder**

Create `packages/twenty-core/src/profile/buildProfileTools.ts`:

```ts
import { z } from "zod";
import type { SchemaCache } from "../schema/cache.js";
import type { ObjectSchema } from "../schema/types.js";
import type { ToolDef } from "../tools/schemaTools.js";
import type { CapabilityProfile, ProfileToolSpec } from "./types.js";

function normalizeScope(scope?: string[]): Set<string> | null {
  return scope ? new Set(scope.map((s) => s.toLowerCase())) : null;
}

function inScope(scopeSet: Set<string>, schema: ObjectSchema): boolean {
  return (
    scopeSet.has(schema.namePlural.toLowerCase()) ||
    scopeSet.has(schema.nameSingular.toLowerCase())
  );
}

export function buildProfileTools(
  profile: CapabilityProfile,
  primitives: ToolDef[],
  cache: SchemaCache,
): ToolDef[] {
  const byName = new Map(primitives.map((t) => [t.name, t]));
  const scopeSet = normalizeScope(profile.objectScope);
  const out: ToolDef[] = [];
  const seen = new Set<string>();

  for (const spec of profile.tools) {
    const base = byName.get(spec.from);
    if (!base) {
      throw new Error(`Profile "${profile.name}" references unknown tool "${spec.from}".`);
    }
    const name = spec.as ?? spec.from;
    if (seen.has(name)) {
      throw new Error(`Profile "${profile.name}" exposes duplicate tool name "${name}".`);
    }
    seen.add(name);

    let inputSchema = base.inputSchema;
    if (spec.bind && Object.keys(spec.bind).length > 0) {
      if (!(inputSchema instanceof z.ZodObject)) {
        throw new Error(
          `Profile "${profile.name}" binds args on "${spec.from}", but its input schema is not an object.`,
        );
      }
      const mask = Object.fromEntries(Object.keys(spec.bind).map((k) => [k, true as const]));
      inputSchema = (inputSchema as z.ZodObject<z.ZodRawShape>).omit(mask);
    }

    out.push({
      name,
      description: spec.description ?? base.description,
      inputSchema,
      handler: makeHandler(base, spec, profile.name, scopeSet, cache),
    });
  }
  return out;
}

function makeHandler(
  base: ToolDef,
  spec: ProfileToolSpec,
  profileName: string,
  scopeSet: Set<string> | null,
  cache: SchemaCache,
): (args: unknown) => Promise<string> {
  return async (args: unknown) => {
    const merged =
      spec.bind && typeof args === "object" && args !== null
        ? { ...(args as Record<string, unknown>), ...spec.bind }
        : (spec.bind ?? args);

    if (scopeSet) {
      const object = (merged as { object?: unknown }).object;
      if (typeof object === "string") {
        await cache.ensureLoaded();
        const schema = cache.resolve(object); // throws on a truly-unknown object
        if (!inScope(scopeSet, schema)) {
          throw new Error(
            `Object "${object}" is not available in the "${profileName}" profile.`,
          );
        }
      }
      if (spec.from === "list_object_types") {
        return filterListToScope(await base.handler(merged), scopeSet);
      }
    }
    return base.handler(merged);
  };
}

function filterListToScope(text: string, scopeSet: Set<string>): string {
  const list = JSON.parse(text) as Array<{ nameSingular: string; namePlural: string }>;
  return JSON.stringify(
    list.filter(
      (o) =>
        scopeSet.has(o.namePlural.toLowerCase()) || scopeSet.has(o.nameSingular.toLowerCase()),
    ),
  );
}
```

- [ ] **Step 5: Export from the barrel**

Add to `packages/twenty-core/src/index.ts`:

```ts
export { buildProfileTools } from "./profile/buildProfileTools.js";
export type { CapabilityProfile, ProfileToolSpec } from "./profile/types.js";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter twenty-core test src/profile/buildProfileTools.test.ts`
Expected: PASS (all cases).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): capability profiles — buildProfileTools with aliasing, arg binding, object scoping"
```

---

### Task 2: `createSegmentServer` (profile-driven server wiring)

**Files:**
- Modify: `packages/twenty-core/src/server.ts`
- Modify: `packages/twenty-core/src/index.ts`
- Test: `packages/twenty-core/src/server.test.ts` (add one case)

**Interfaces:**
- Consumes: `CapabilityProfile` (`./profile/types.js`), `buildProfileTools` (`./profile/buildProfileTools.js`), the existing `buildTools`, `Connection`, `ServerMeta`.
- Produces: `createSegmentServer(connection: Connection, profile: CapabilityProfile, meta: ServerMeta, fetchImpl?: typeof fetch): { server: McpServer; cache: SchemaCache }` — same shape as `createServer` but registers the profile's curated tools and a **scope-filtered** `twenty://schema` resource. `createServer` is refactored to share a private `wireServer` helper with no behavior change.

- [ ] **Step 1: Add a regression + curation test**

Add to `packages/twenty-core/src/server.test.ts` (keep the existing `buildTools` test). Append:

```ts
import { createSegmentServer } from "./server.js";
import type { CapabilityProfile } from "./profile/types.js";
import type { Connection } from "./auth/types.js";

describe("createSegmentServer", () => {
  it("builds without throwing for a valid profile over the real primitives", () => {
    const conn: Connection = { label: "t", baseUrl: "https://x", getBearer: async () => "k" };
    const profile: CapabilityProfile = {
      name: "crm",
      objectScope: ["people"],
      tools: [{ from: "query_records", as: "find_contacts", bind: { object: "people" } }, { from: "search" }],
    };
    // Should wire without error (validates the profile references real primitive names).
    expect(() =>
      createSegmentServer(conn, profile, { name: "t", version: "0" }, vi.fn() as unknown as typeof fetch),
    ).not.toThrow();
  });

  it("rejects a profile that references an unknown primitive", () => {
    const conn: Connection = { label: "t", baseUrl: "https://x", getBearer: async () => "k" };
    const bad: CapabilityProfile = { name: "x", tools: [{ from: "does_not_exist" }] };
    expect(() =>
      createSegmentServer(conn, bad, { name: "t", version: "0" }, vi.fn() as unknown as typeof fetch),
    ).toThrow(/unknown tool "does_not_exist"/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter twenty-core test src/server.test.ts`
Expected: FAIL — `createSegmentServer` is not exported.

- [ ] **Step 3: Refactor `server.ts` to add `wireServer` + `createSegmentServer`**

In `packages/twenty-core/src/server.ts`, add imports after the existing ones:

```ts
import type { CapabilityProfile } from "./profile/types.js";
import { buildProfileTools } from "./profile/buildProfileTools.js";
```

Add a private helper (place it above `createServer`):

```ts
function wireServer(
  server: McpServer,
  tools: ToolDef[],
  cache: SchemaCache,
  objectScope?: string[],
): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: unknown) => {
        const text = await tool.handler(args);
        return { content: [{ type: "text" as const, text }] };
      },
    );
  }

  const scopeSet = objectScope ? new Set(objectScope.map((s) => s.toLowerCase())) : null;
  server.registerResource(
    "schema",
    "twenty://schema",
    { description: "The live Twenty schema (objects and fields) as JSON." },
    async () => {
      await cache.ensureLoaded();
      const list = scopeSet
        ? cache
            .list()
            .filter(
              (o) =>
                scopeSet.has(o.namePlural.toLowerCase()) ||
                scopeSet.has(o.nameSingular.toLowerCase()),
            )
        : cache.list();
      return {
        contents: [
          { uri: "twenty://schema", mimeType: "application/json", text: JSON.stringify(list) },
        ],
      };
    },
  );
}
```

Replace the body of `createServer` (keep its signature) so it delegates to `wireServer`:

```ts
export function createServer(
  connection: Connection,
  meta: ServerMeta,
  fetchImpl: typeof fetch = fetch,
): { server: McpServer; cache: SchemaCache } {
  const rest = new RestClient(connection, fetchImpl);
  const gql = new GraphQLClient(connection, fetchImpl);
  const cache = new SchemaCache(rest);
  const server = new McpServer({ name: meta.name, version: meta.version });
  wireServer(server, buildTools(rest, gql, cache), cache);
  return { server, cache };
}
```

Add `createSegmentServer` below it:

```ts
export function createSegmentServer(
  connection: Connection,
  profile: CapabilityProfile,
  meta: ServerMeta,
  fetchImpl: typeof fetch = fetch,
): { server: McpServer; cache: SchemaCache } {
  const rest = new RestClient(connection, fetchImpl);
  const gql = new GraphQLClient(connection, fetchImpl);
  const cache = new SchemaCache(rest);
  const server = new McpServer({ name: meta.name, version: meta.version });
  const primitives = buildTools(rest, gql, cache);
  wireServer(server, buildProfileTools(profile, primitives, cache), cache, profile.objectScope);
  return { server, cache };
}
```

(Delete the old inline tool-registration + resource block that used to live in `createServer` — it now lives in `wireServer`.)

- [ ] **Step 4: Export from the barrel**

Add to `packages/twenty-core/src/index.ts`:

```ts
export { createSegmentServer } from "./server.js";
```

- [ ] **Step 5: Run the core suite**

Run: `pnpm --filter twenty-core test`
Expected: PASS — the existing `buildTools` test, the new `createSegmentServer` cases, and all prior tests are green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): createSegmentServer wires a profile's curated tools + scope-filtered schema resource"
```

---

### Task 3: The CRM profile + wire the CRM segment

**Files:**
- Create: `packages/twenty-crm-mcp/src/profile.ts`
- Test: `packages/twenty-crm-mcp/src/profile.test.ts`
- Modify: `packages/twenty-crm-mcp/src/index.ts`

**Interfaces:**
- Consumes: `CapabilityProfile`, `buildProfileTools`, `createSegmentServer`, `resolveActiveConnection`, `buildTools` (indirectly), `RestClient`/`GraphQLClient`/`SchemaCache` (for the test's primitives) from `twenty-core`.
- Produces: `crmProfile: CapabilityProfile` — objectScope of the five core CRM objects, exposing scoped generic tools plus a few business-named aliases. The server entry uses it via `createSegmentServer`.

- [ ] **Step 1: Write the failing test**

Create `packages/twenty-crm-mcp/src/profile.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { buildProfileTools, type ToolDef } from "twenty-core";
import { crmProfile } from "./profile.js";

// Minimal fakes of the 10 core primitive names so we can validate the profile's `from` references.
function corePrimitives(): ToolDef[] {
  const names = [
    "list_object_types", "describe_object", "refresh_schema",
    "query_records", "get_record", "search",
    "create_records", "update_records", "delete_records", "upsert_records",
  ];
  return names.map((name) => ({
    name,
    description: `${name} primitive.`,
    inputSchema: z.object({ object: z.string().optional() }),
    handler: async () => "[]",
  }));
}

const cache = { ensureLoaded: vi.fn().mockResolvedValue(undefined), resolve: () => ({ namePlural: "people", nameSingular: "person" }) } as any;

describe("crmProfile", () => {
  it("scopes to the five core CRM objects and excludes system objects", () => {
    expect(crmProfile.objectScope).toEqual(["people", "companies", "opportunities", "tasks", "notes"]);
    expect(crmProfile.objectScope).not.toContain("workflows");
  });

  it("references only real primitives and exposes unique, business-named tools", () => {
    const tools = buildProfileTools(crmProfile, corePrimitives(), cache);
    const names = tools.map((t) => t.name);
    expect(names).toContain("find_contacts");
    expect(names).toContain("find_companies");
    expect(new Set(names).size).toBe(names.length); // unique
    // building did not throw → every `from` maps to a real primitive
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter twenty-crm-mcp test src/profile.test.ts`
Expected: FAIL — cannot resolve `./profile.js`.

- [ ] **Step 3: Write the CRM profile**

Create `packages/twenty-crm-mcp/src/profile.ts`:

```ts
import type { CapabilityProfile } from "twenty-core";

/**
 * The everyday CRM surface: reachable objects are limited to the core CRM set, so the
 * assistant never sees or touches Twenty's system/plumbing objects. Business-named aliases
 * sit alongside the scoped generic tools for the common lookups.
 */
export const crmProfile: CapabilityProfile = {
  name: "crm",
  objectScope: ["people", "companies", "opportunities", "tasks", "notes"],
  tools: [
    { from: "list_object_types" },
    { from: "describe_object" },
    { from: "refresh_schema" },
    {
      from: "query_records",
      as: "find_contacts",
      bind: { object: "people" },
      description:
        "Find people (contacts) in the CRM. Filter syntax: field[operator]:value, e.g. name[eq]:Ada.",
    },
    {
      from: "query_records",
      as: "find_companies",
      bind: { object: "companies" },
      description: "Find companies in the CRM. Filter syntax: field[operator]:value.",
    },
    {
      from: "query_records",
      as: "find_opportunities",
      bind: { object: "opportunities" },
      description: "Find opportunities in the CRM. Filter syntax: field[operator]:value.",
    },
    { from: "query_records" },
    { from: "get_record" },
    { from: "search" },
    {
      from: "create_records",
      as: "create_tasks",
      bind: { object: "tasks" },
      description: "Create 1–60 tasks in a single batch.",
    },
    { from: "create_records" },
    { from: "update_records" },
    { from: "delete_records" },
    { from: "upsert_records" },
  ],
};
```

- [ ] **Step 4: Wire the server entry to the CRM profile**

Overwrite `packages/twenty-crm-mcp/src/index.ts`:

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveActiveConnection, createSegmentServer } from "twenty-core";
import { crmProfile } from "./profile.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

async function main(): Promise<void> {
  const connection = resolveActiveConnection(process.env);
  const { server } = createSegmentServer(connection, crmProfile, {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 5: Run the test, then the full suite, then build**

Run: `pnpm --filter twenty-crm-mcp test src/profile.test.ts`
Expected: PASS.

Run: `pnpm -r test`
Expected: PASS — both packages green.

Run: `pnpm --filter twenty-crm-mcp build`
Expected: produces `dist/index.js` and `dist/cli-bin.js`.

- [ ] **Step 6: Live smoke (manual, against the signed-in connection)**

With an OAuth (or API-key) connection configured, confirm the curation works end to end:

```bash
(printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_object_types","arguments":{}}}' \
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"query_records","arguments":{"object":"workflows"}}}'; sleep 3) \
 | TWENTY_CONNECTION=live node packages/twenty-crm-mcp/dist/index.js
```

Expected: request `id:2` returns **only** the five CRM objects (people/companies/opportunities/tasks/notes), not the full ~26-object list; request `id:3` returns an error whose text says `workflows` is not available in the "crm" profile. Record the outcome.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(crm): curated CRM segment via the crm capability profile (object-scoped + aliased tools)"
```

---

## Self-Review

**Spec coverage (foundation design — profile/curation portion):**
- Capability profile: object scope + tool exposure/aliasing/binding — Task 1. ✅
- Enforcement order (scope refusal before the Twenty call; scope-filtered schema resource) — Tasks 1–2. ✅
- Segment = profile + wiring, no new handler code for CRM — Task 3 (CRM needs zero handler code, just a profile literal). ✅
- Resilience preserved: profiles name objects but resolve against the live schema; nothing hardcoded in compiled logic beyond names that degrade to normal errors. ✅
- **Deferred (explicitly out of scope, later cycles):** `expand`, recipe runner + composites, audit, `readOnly`/`expectedRole` fields, `switch_connection`. Noted in Global Constraints.

**Placeholder scan:** No TBD/TODO; every code step is complete; the one manual step (3.6 live smoke) gives exact commands and expected output.

**Type consistency:** `ProfileToolSpec`/`CapabilityProfile` (Task 1) are consumed unchanged by `createSegmentServer` (Task 2) and `crmProfile` (Task 3). `buildProfileTools(profile, primitives, cache)` signature matches across its definition (Task 1) and both callers (Task 2's `createSegmentServer`, Task 3's test). `createSegmentServer(connection, profile, meta, fetchImpl?)` matches between its definition (Task 2) and the server entry (Task 3). `ToolDef` shape (`{ name, description, inputSchema, handler }`) is used consistently.

**Note for the implementer:** in zod v4, `z.object({...}).omit({ key: true })` returns a new `ZodObject` and `.shape` reflects the omitted keys — the Task 1 test asserts `"object" in schema.shape === false` to prove the bound arg is hidden from the model. If `.omit` behaves differently on the installed zod, STOP and report rather than working around it.
