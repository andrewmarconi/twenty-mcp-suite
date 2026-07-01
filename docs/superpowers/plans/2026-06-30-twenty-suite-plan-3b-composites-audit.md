# Twenty Suite — Plan 3b: Composite Reads (depth) + Audit Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add business-level composite read tools (`get_contact_brief`, `get_account_snapshot`) to the CRM segment and structured audit logging of every tool invocation — the composites reusing Twenty's native relation `depth` (verified live: `depth: 1` returns nested relations) so no recipe engine is needed this cycle.

**Architecture:** `get_record` gains an optional `depth` (0–2) so a single by-id read can return one level of related records. The composites are then *depth-bound profile aliases* over `get_record` (Plan 3a's mechanism) — zero new handler code. Audit is a small cross-cutting wrapper (`withAudit`) that times each tool handler and emits a structured JSON line to **stderr**; it wraps the tool list in both `createServer` and `createSegmentServer`. The `expand` primitive and a multi-step recipe runner are explicitly deferred (a recipe runner would need per-step scope enforcement — out of scope until a genuine multi-object/aggregation need arises).

**Tech Stack:** TypeScript ESM, zod v4, `@modelcontextprotocol/sdk`, vitest. **No new dependencies.**

## Global Constraints

- Node `>=20`; ESM only; **`.js` import extensions** on local imports.
- Package manager **pnpm**; **no new dependencies**.
- **stdout is reserved for the MCP protocol.** Audit output goes to **stderr** (`console.error`) only.
- **Never log a token, secret, or record contents in audit.** Audit records only tool name, connection label, environment, outcome (ok|error), duration, and (on error) the error *message* — never args, results, or credentials.
- **Resilience preserved:** composites name objects (`people`/`companies`) but resolve against the live schema via the existing profile scope + cache; `depth` is a generic read modifier, not schema-specific.
- **Behavior-preserving where noted:** adding `depth` to `get_record` is additive (optional param); the generic `createServer` path keeps its tool surface (now audit-wrapped, same behavior otherwise).
- **Deferred (do NOT build here):** the `expand` primitive, a recipe runner / declarative multi-step composites, `readOnly`/`expectedRole` profile fields, `switch_connection`.

## File Structure

- `packages/twenty-core/src/tools/readTools.ts` — add optional `depth` to `get_record` (modify).
- `packages/twenty-core/src/tools/readTools.test.ts` — update/extend the `get_record` case (modify).
- `packages/twenty-core/src/audit/audit.ts` — `AuditEntry`, `AuditSink`, `stderrAuditSink`, `auditWrap`, `withAudit` (new).
- `packages/twenty-core/src/audit/audit.test.ts` — unit tests (new).
- `packages/twenty-core/src/server.ts` — wrap tools with `withAudit` in both server builders (modify).
- `packages/twenty-core/src/index.ts` — barrel exports (modify).
- `packages/twenty-crm-mcp/src/profile.ts` — add the two composite aliases (modify).
- `packages/twenty-crm-mcp/src/profile.test.ts` — assert the composites (modify).

---

### Task 1: Add `depth` to `get_record`

**Files:**
- Modify: `packages/twenty-core/src/tools/readTools.ts`
- Modify: `packages/twenty-core/src/tools/readTools.test.ts`

**Interfaces:**
- Consumes: `RestClient.get(path, query?)` (query values that are `undefined` are skipped).
- Produces: `get_record` input schema becomes `{ object: string; id: string; depth?: number (int 0–2) }`; the handler forwards `depth` as a REST query param (`GET /rest/<plural>/<id>?depth=<n>`), returning the record with one/two levels of related records inlined. Absent `depth` behaves exactly as before.

- [ ] **Step 1: Update the test to expect the depth-aware call**

In `packages/twenty-core/src/tools/readTools.test.ts`, replace the existing `get_record` test:

```ts
  it("get_record fetches by id", async () => {
    const rest = { get: vi.fn().mockResolvedValue({ data: { person: { id: "1" } } }) };
    await tool("get_record", rest).handler({ object: "people", id: "1" });
    expect(rest.get).toHaveBeenCalledWith("/rest/people/1");
  });
```

with:

```ts
  it("get_record fetches by id (no depth → depth omitted)", async () => {
    const rest = { get: vi.fn().mockResolvedValue({ data: { person: { id: "1" } } }) };
    await tool("get_record", rest).handler({ object: "people", id: "1" });
    expect(rest.get).toHaveBeenCalledWith("/rest/people/1", { depth: undefined });
  });

  it("get_record forwards depth as a query param", async () => {
    const rest = { get: vi.fn().mockResolvedValue({ data: { person: { id: "1", company: {} } } }) };
    await tool("get_record", rest).handler({ object: "people", id: "1", depth: 1 });
    expect(rest.get).toHaveBeenCalledWith("/rest/people/1", { depth: 1 });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter twenty-core test src/tools/readTools.test.ts`
Expected: FAIL — `get_record` currently calls `rest.get("/rest/people/1")` with no second argument, so the new `{ depth: ... }` assertions don't match.

- [ ] **Step 3: Add `depth` to the `get_record` tool**

In `packages/twenty-core/src/tools/readTools.ts`, replace the `get_record` tool definition:

```ts
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
```

with:

```ts
    {
      name: "get_record",
      description:
        "Fetch a single record by id. Optional depth (0–2) inlines related records one/two levels deep.",
      inputSchema: z.object({
        object: z.string(),
        id: z.string(),
        depth: z.number().int().min(0).max(2).optional(),
      }),
      handler: async (args) => {
        const a = z
          .object({
            object: z.string(),
            id: z.string(),
            depth: z.number().int().min(0).max(2).optional(),
          })
          .parse(args);
        await cache.ensureLoaded();
        const obj = cache.resolve(a.object);
        return withDriftHandling(a.object, async () =>
          JSON.stringify(await rest.get(`/rest/${obj.namePlural}/${a.id}`, { depth: a.depth })),
        );
      },
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter twenty-core test src/tools/readTools.test.ts`
Expected: PASS (both `get_record` cases + the unchanged `query_records`/drift cases).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): add optional depth to get_record (inline related records)"
```

---

### Task 2: CRM composite reads (`get_contact_brief`, `get_account_snapshot`)

**Files:**
- Modify: `packages/twenty-crm-mcp/src/profile.ts`
- Modify: `packages/twenty-crm-mcp/src/profile.test.ts`

**Interfaces:**
- Consumes: `get_record` with `depth` (Task 1), the profile alias/bind mechanism (Plan 3a). Binding `{ object, depth }` omits both from the exposed schema, so each composite takes just `{ id }`.
- Produces: two new exposed tools on the CRM profile — `get_contact_brief` (a person + related records, depth 1) and `get_account_snapshot` (a company + related records, depth 1).

- [ ] **Step 1: Extend the profile test**

In `packages/twenty-crm-mcp/src/profile.test.ts`, add a case to the `describe("crmProfile", ...)` block. First ensure the fake `corePrimitives()` `get_record` schema includes `depth` so the bind can omit it — update the primitives factory's schema to `z.object({ object: z.string().optional(), id: z.string().optional(), depth: z.number().optional() })` (a superset is fine for the fake). Then add:

```ts
  it("exposes depth-bound composite reads that take only an id", () => {
    const tools = buildProfileTools(crmProfile, corePrimitives(), cache);
    const brief = tools.find((t) => t.name === "get_contact_brief")!;
    const snapshot = tools.find((t) => t.name === "get_account_snapshot")!;
    expect(brief).toBeDefined();
    expect(snapshot).toBeDefined();
    // object + depth are bound, so they are omitted from the exposed schema (only `id` remains):
    const briefShape = (brief.inputSchema as import("zod").ZodObject<any>).shape;
    expect("object" in briefShape).toBe(false);
    expect("depth" in briefShape).toBe(false);
    expect("id" in briefShape).toBe(true);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter twenty-crm-mcp test src/profile.test.ts`
Expected: FAIL — `get_contact_brief` / `get_account_snapshot` are not in the profile yet.

- [ ] **Step 3: Add the composites to the CRM profile**

In `packages/twenty-crm-mcp/src/profile.ts`, add these two entries to the `tools` array (place them after `{ from: "get_record" }`):

```ts
    {
      from: "get_record",
      as: "get_contact_brief",
      bind: { object: "people", depth: 1 },
      description:
        "Fetch one person (by id) together with their related company, notes, tasks, opportunities, and recent activity (one level deep).",
    },
    {
      from: "get_record",
      as: "get_account_snapshot",
      bind: { object: "companies", depth: 1 },
      description:
        "Fetch one company (by id) together with its related people, opportunities, notes, and tasks (one level deep).",
    },
```

- [ ] **Step 4: Run the profile test, full suite, and build**

Run: `pnpm --filter twenty-crm-mcp test src/profile.test.ts`
Expected: PASS.

Run: `pnpm -r test`
Expected: PASS — both packages green.

Run: `pnpm --filter twenty-crm-mcp build`
Expected: produces `dist/index.js` + `dist/cli-bin.js`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(crm): get_contact_brief + get_account_snapshot composite reads (depth-bound)"
```

---

### Task 3: Audit logging

**Files:**
- Create: `packages/twenty-core/src/audit/audit.ts`
- Create: `packages/twenty-core/src/audit/audit.test.ts`
- Modify: `packages/twenty-core/src/server.ts`
- Modify: `packages/twenty-core/src/index.ts`

**Interfaces:**
- Consumes: `ToolDef` (`../tools/schemaTools.js`).
- Produces:
  - `interface AuditEntry { tool: string; connection: string; env?: string; outcome: "ok" | "error"; ms: number; error?: string }`
  - `type AuditSink = (entry: AuditEntry) => void`
  - `const stderrAuditSink: AuditSink` — writes `JSON.stringify({ audit: entry })` to `console.error`.
  - `function auditWrap(handler, meta: { tool; connection; env? }, sink: AuditSink, now?: () => number): (args) => Promise<string>` — times the handler; emits an `ok`/`error` entry; rethrows on error.
  - `function withAudit(tools: ToolDef[], meta: { connection: string; env?: string }, sink?: AuditSink): ToolDef[]` — returns tools whose handlers are audit-wrapped.
  - `createServer`/`createSegmentServer` wrap their tool list with `withAudit({ connection: connection.label, env: connection.env })` before wiring.

- [ ] **Step 1: Write the failing test**

Create `packages/twenty-core/src/audit/audit.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { auditWrap, withAudit } from "./audit.js";
import type { AuditEntry } from "./audit.js";
import type { ToolDef } from "../tools/schemaTools.js";

function clock(times: number[]): () => number {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
}

describe("auditWrap", () => {
  it("emits an ok entry with duration on success and returns the result", async () => {
    const entries: AuditEntry[] = [];
    const wrapped = auditWrap(
      async () => "result",
      { tool: "find_contacts", connection: "acme", env: "prod" },
      (e) => entries.push(e),
      clock([1000, 1025]),
    );
    expect(await wrapped({})).toBe("result");
    expect(entries).toEqual([
      { tool: "find_contacts", connection: "acme", env: "prod", outcome: "ok", ms: 25 },
    ]);
  });

  it("emits an error entry (with the message, not args) and rethrows", async () => {
    const entries: AuditEntry[] = [];
    const wrapped = auditWrap(
      async () => {
        throw new Error("boom");
      },
      { tool: "delete_records", connection: "acme" },
      (e) => entries.push(e),
      clock([0, 10]),
    );
    await expect(wrapped({ secret: "x" })).rejects.toThrow("boom");
    expect(entries[0]).toEqual({
      tool: "delete_records", connection: "acme", env: undefined, outcome: "error", ms: 10, error: "boom",
    });
    // the audit entry must not carry the args:
    expect(JSON.stringify(entries[0])).not.toContain("secret");
  });
});

describe("withAudit", () => {
  it("wraps every tool's handler and preserves name/description/schema", async () => {
    const entries: AuditEntry[] = [];
    const tools: ToolDef[] = [
      { name: "t1", description: "d1", inputSchema: z.object({}), handler: async () => "a" },
      { name: "t2", description: "d2", inputSchema: z.object({}), handler: async () => "b" },
    ];
    const wrapped = withAudit(tools, { connection: "acme" }, (e) => entries.push(e));
    expect(wrapped.map((t) => t.name)).toEqual(["t1", "t2"]);
    expect(wrapped[0].description).toBe("d1");
    await wrapped[0].handler({});
    await wrapped[1].handler({});
    expect(entries.map((e) => e.tool)).toEqual(["t1", "t2"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter twenty-core test src/audit/audit.test.ts`
Expected: FAIL — cannot resolve `./audit.js`.

- [ ] **Step 3: Implement the audit module**

Create `packages/twenty-core/src/audit/audit.ts`:

```ts
import type { ToolDef } from "../tools/schemaTools.js";

export interface AuditEntry {
  tool: string;
  connection: string;
  env?: string;
  outcome: "ok" | "error";
  ms: number;
  error?: string;
}

export type AuditSink = (entry: AuditEntry) => void;

/** Default sink: one structured JSON line per tool call, on stderr (never stdout). */
export const stderrAuditSink: AuditSink = (entry) => {
  console.error(JSON.stringify({ audit: entry }));
};

export function auditWrap(
  handler: (args: unknown) => Promise<string>,
  meta: { tool: string; connection: string; env?: string },
  sink: AuditSink,
  now: () => number = () => Date.now(),
): (args: unknown) => Promise<string> {
  return async (args: unknown) => {
    const start = now();
    try {
      const result = await handler(args);
      sink({ tool: meta.tool, connection: meta.connection, env: meta.env, outcome: "ok", ms: now() - start });
      return result;
    } catch (err) {
      sink({
        tool: meta.tool,
        connection: meta.connection,
        env: meta.env,
        outcome: "error",
        ms: now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}

export function withAudit(
  tools: ToolDef[],
  meta: { connection: string; env?: string },
  sink: AuditSink = stderrAuditSink,
): ToolDef[] {
  return tools.map((t) => ({
    ...t,
    handler: auditWrap(t.handler, { tool: t.name, connection: meta.connection, env: meta.env }, sink),
  }));
}
```

- [ ] **Step 4: Wire audit into both server builders**

In `packages/twenty-core/src/server.ts`, add the import (with the other imports):

```ts
import { withAudit } from "./audit/audit.js";
```

In `createServer`, change the wiring line from:

```ts
  wireServer(server, buildTools(rest, gql, cache), cache);
```

to:

```ts
  const tools = withAudit(buildTools(rest, gql, cache), {
    connection: connection.label,
    env: connection.env,
  });
  wireServer(server, tools, cache);
```

In `createSegmentServer`, change:

```ts
  const primitives = buildTools(rest, gql, cache);
  wireServer(server, buildProfileTools(profile, primitives, cache), cache, profile.objectScope);
```

to:

```ts
  const primitives = buildTools(rest, gql, cache);
  const tools = withAudit(buildProfileTools(profile, primitives, cache), {
    connection: connection.label,
    env: connection.env,
  });
  wireServer(server, tools, cache, profile.objectScope);
```

- [ ] **Step 5: Export from the barrel**

Add to `packages/twenty-core/src/index.ts`:

```ts
export { auditWrap, withAudit, stderrAuditSink } from "./audit/audit.js";
export type { AuditEntry, AuditSink } from "./audit/audit.js";
```

- [ ] **Step 6: Run the audit test and the full suite**

Run: `pnpm --filter twenty-core test src/audit/audit.test.ts`
Expected: PASS.

Run: `pnpm -r test`
Expected: PASS — both packages green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): structured stderr audit logging for every tool invocation"
```

---

### Task 4: Live smoke (manual — operator)

**Files:** none (verification only).

This confirms the composites return expanded records and that audit lines appear on stderr. It needs a signed-in connection, so it is operator-run.

- [ ] **Step 1: Build**

Run: `pnpm --filter twenty-crm-mcp build`
Expected: both bins produced.

- [ ] **Step 2: Confirm `get_contact_brief` returns an expanded record + audit on stderr**

Pick a real person id (e.g. from a `find_contacts` call), then:

```bash
(printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_contact_brief","arguments":{"id":"<A_PERSON_ID>"}}}'; sleep 3) \
 | TWENTY_CONNECTION=live node packages/twenty-crm-mcp/dist/index.js
```

Expected: request `id:2` (on **stdout**) returns the person with a nested `company` object and related records inlined; on **stderr** you see one `{"audit":{"tool":"get_contact_brief","connection":"live",...,"outcome":"ok","ms":...}}` line. Record the outcome (and whether `get_record` honored `depth` on the single-record path — if the record comes back *shallow*, note it: the composite should then be re-based on `query_records` with an `id[eq]` filter, which is known to honor `depth`).

---

## Self-Review

**Spec coverage (foundation design — composites + audit portion):**
- Composite/business-level read tools (`get_contact_brief`, `get_account_snapshot`) — Tasks 1–2, delivered as depth-bound profile aliases (no new handler code). ✅
- Audit metadata for tool invocations (`{ connection, env, tool, outcome }` + duration) — Task 3. ✅
- Resilience preserved: composites resolve objects against the live schema; `depth` is a generic modifier. ✅
- **Deferred (explicit):** the `expand` primitive and a multi-step recipe runner — the live-verified `depth` capability makes them unnecessary for read composites this cycle; a recipe runner (which needs per-step scope enforcement) waits for a genuine multi-object/aggregation need. Noted in Global Constraints.

**Placeholder scan:** No TBD/TODO; every code step is complete; the one manual step (Task 4) gives exact commands and expected output including the fallback if single-record `depth` isn't honored.

**Type consistency:** `get_record`'s new `depth?` param (Task 1) is what the composites bind (Task 2). `AuditEntry`/`AuditSink` (Task 3) are consumed by `auditWrap`/`withAudit` and the barrel. `withAudit(tools, { connection, env? }, sink?)` matches between its definition (Task 3) and both call sites in `server.ts`. `Connection` provides `label` and optional `env` (from Plan 1) — used verbatim as the audit `connection`/`env`.

**Risk note for the implementer (Task 1/Task 4):** Twenty's `depth` is verified to inline relations on the *collection* read (`query_records`/`find_contacts`). The single-record `GET /rest/<plural>/<id>?depth=1` path is assumed to honor it too but is only confirmed by the Task 4 live smoke. If it does not, the composites should re-base on `query_records` bound to `{ object, depth: 1 }` with the model filtering by `id[eq]` — do not silently ship a shallow `get_contact_brief`.
