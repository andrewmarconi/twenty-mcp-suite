# Token-Store Locking + Encrypted API-Key Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `FileTokenStore` safe for concurrent writers (issue #9) and let API keys be stored in the encrypted token store as an alternative to env vars (issue #16).

**Architecture:** Phase 1 hardens `FileTokenStore` internally — atomic temp-file+rename writes and a zero-dependency advisory lockfile around `set()`/`delete()`. Phase 2 widens the stored record type to a `StoredCredential` discriminated union (`oauth` | `apikey`), adds a lazy `StoredApiKeyProvider` with env-over-store precedence, and wires key entry into `twenty-mcp login` and the setup TUI via a new masked `password` prompt.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Node >= 22, vitest, `@clack/prompts`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-01-token-store-locking-and-api-keys-design.md`

## Global Constraints

- Package manager is **pnpm**; run tests as `pnpm --filter <pkg> test [file]`.
- ESM with `.js` extensions on local imports (`import { x } from "./tokenStore.js"`).
- Cross-package imports use the bare name `twenty-core`; every new public symbol of `twenty-core` must be added to the explicit named exports in `packages/twenty-core/src/index.ts`.
- stdout is reserved for the MCP protocol in the server; the CLI may use stdout freely.
- Tests inject fakes and never hit the network; token-store tests use real temp dirs (`mkdtempSync`).
- **No new npm dependencies.**
- `twenty-crm-mcp` resolves `twenty-core` from its built `dist/` — run `pnpm --filter twenty-core build` before running `twenty-crm-mcp` tests that consume new core exports.
- The registry file (`connections.json`) never stores secrets; secrets never appear on argv.

---

## Phase 1 — FileTokenStore locking + atomic writes (#9)

### Task 1: Atomic writes in `FileTokenStore.writeAll`

**Files:**
- Modify: `packages/twenty-core/src/auth/tokenStore.ts` (the `writeAll` method, currently lines 123–126)
- Test: `packages/twenty-core/src/auth/tokenStore.test.ts`

**Interfaces:**
- Consumes: existing private `writeAll(all: Record<string, Blob>): void`.
- Produces: same signature, now crash-safe. No public API change. Later tasks rely on the invariant: *readers can never observe a partially written `tokens.json`*.

- [ ] **Step 1: Write the failing test**

Add to `packages/twenty-core/src/auth/tokenStore.test.ts` (extend the existing imports from `node:fs` with `chmodSync` and `readdirSync`):

```ts
describe("FileTokenStore — atomic writes", () => {
  it("re-asserts 0600 on tokens.json even if permissions drifted", async () => {
    const store = new FileTokenStore(dir);
    await store.set("acme", rec);
    chmodSync(join(dir, "tokens.json"), 0o644);
    await store.set("other", rec);
    const mode = statSync(join(dir, "tokens.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("leaves no temp files behind after writes", async () => {
    const store = new FileTokenStore(dir);
    await store.set("acme", rec);
    await store.delete("acme");
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });
});
```

The first test fails against the current implementation because `writeFileSync` with a `mode` option only applies the mode when *creating* the file — an in-place overwrite leaves drifted permissions alone. Temp-file+rename recreates the file every write. (The rename's atomicity itself isn't black-box testable; these tests pin the observable consequences, and the atomicity property is verified by code review.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter twenty-core test src/auth/tokenStore.test.ts`
Expected: FAIL — `re-asserts 0600…` gets `0o644`, expected `0o600`. The `leftovers` test passes (trivially) — that's fine; it's a regression guard for the new code path.

- [ ] **Step 3: Implement temp-file+rename**

In `packages/twenty-core/src/auth/tokenStore.ts`, extend the `node:fs` import with `renameSync` and replace `writeAll`:

```ts
private writeAll(all: Record<string, Blob>): void {
  mkdirSync(this.dir, { recursive: true });
  // Write-then-rename: same-directory rename is atomic, so readers never
  // observe a torn tokens.json, and 0600 is re-asserted on every write.
  const tmp = join(
    this.dir,
    `tokens.json.tmp-${process.pid}-${randomBytes(4).toString("hex")}`,
  );
  writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
  renameSync(tmp, this.dataPath);
}
```

- [ ] **Step 4: Run the full package suite to verify it passes**

Run: `pnpm --filter twenty-core test`
Expected: PASS (all existing tokenStore tests plus the two new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/twenty-core/src/auth/tokenStore.ts packages/twenty-core/src/auth/tokenStore.test.ts
git commit -m "fix(core): atomic temp-file+rename writes in FileTokenStore"
```

---

### Task 2: Advisory lockfile around `set()` and `delete()`

**Files:**
- Modify: `packages/twenty-core/src/auth/tokenStore.ts`
- Test: `packages/twenty-core/src/auth/tokenStore.test.ts`

**Interfaces:**
- Consumes: Task 1's atomic `writeAll`.
- Produces: `FileTokenStore` constructor gains an optional second argument:
  ```ts
  export interface FileTokenStoreOptions {
    lockStaleMs?: number;   // default 10_000 — break locks older than this
    lockTimeoutMs?: number; // default 5_000  — give up waiting after this
    lockRetryMs?: number;   // default 25     — sleep between acquire attempts
    sleep?: (ms: number) => Promise<void>;
  }
  constructor(dir: string, opts?: FileTokenStoreOptions)
  ```
  `set()` and `delete()` serialize via `<dir>/tokens.json.lock`. `get()`/`labels()` remain lock-free. Later tasks and all existing callers are unaffected (the argument is optional).

**Why these tests and not an interleaving test:** within one Node process the read-modify-write is synchronous, so two in-process `set()`s can never interleave — the lost-update race is *cross-process* (CLI `login` vs. server refresh). The tests therefore pin the lock mechanics directly: waiting, stale-breaking, timeout, and release.

- [ ] **Step 1: Write the failing tests**

Add to `packages/twenty-core/src/auth/tokenStore.test.ts` (extend `node:fs` imports with `unlinkSync`, `utimesSync`, `existsSync`):

```ts
describe("FileTokenStore — lockfile", () => {
  const lockPath = () => join(dir, "tokens.json.lock");

  it("set() waits for an existing lock and proceeds once it is released", async () => {
    const store = new FileTokenStore(dir, { lockRetryMs: 5 });
    writeFileSync(lockPath(), "999999", { flag: "wx" });
    const pending = store.set("acme", rec);
    await new Promise((r) => setTimeout(r, 30));
    expect(await new FileTokenStore(dir).get("acme")).toBeNull(); // still blocked
    unlinkSync(lockPath());
    await pending;
    expect(await new FileTokenStore(dir).get("acme")).toEqual(rec);
  });

  it("breaks a stale lock and proceeds", async () => {
    writeFileSync(lockPath(), "999999", { flag: "wx" });
    const past = new Date(Date.now() - 60_000);
    utimesSync(lockPath(), past, past);
    const store = new FileTokenStore(dir, { lockRetryMs: 5, lockStaleMs: 10_000 });
    await store.set("acme", rec);
    expect(await store.get("acme")).toEqual(rec);
  });

  it("times out with an actionable error when the lock never frees", async () => {
    writeFileSync(lockPath(), "999999", { flag: "wx" });
    const store = new FileTokenStore(dir, {
      lockRetryMs: 5,
      lockTimeoutMs: 50,
      lockStaleMs: 60_000,
    });
    await expect(store.set("acme", rec)).rejects.toThrow(/lock/i);
  });

  it("removes the lock file after set() and delete()", async () => {
    const store = new FileTokenStore(dir);
    await store.set("acme", rec);
    expect(existsSync(lockPath())).toBe(false);
    await store.delete("acme");
    expect(existsSync(lockPath())).toBe(false);
  });

  it("concurrent set()s from two instances both land", async () => {
    const a = new FileTokenStore(dir, { lockRetryMs: 5 });
    const b = new FileTokenStore(dir, { lockRetryMs: 5 });
    await Promise.all([a.set("a", rec), b.set("b", rec)]);
    expect((await a.labels()).sort()).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter twenty-core test src/auth/tokenStore.test.ts`
Expected: FAIL — constructor rejects the options object at the type level and/or `set() waits…` fails because the current `set()` ignores the lock file and stores the record immediately.

- [ ] **Step 3: Implement the lock**

In `packages/twenty-core/src/auth/tokenStore.ts`, extend the `node:fs` import with `statSync` and `unlinkSync`, then:

```ts
export interface FileTokenStoreOptions {
  lockStaleMs?: number;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class FileTokenStore implements TokenStore {
  private readonly keyPath: string;
  private readonly dataPath: string;
  private readonly lockPath: string;
  private readonly lockStaleMs: number;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly dir: string,
    opts: FileTokenStoreOptions = {},
  ) {
    this.keyPath = join(dir, "store.key");
    this.dataPath = join(dir, "tokens.json");
    this.lockPath = join(dir, "tokens.json.lock");
    this.lockStaleMs = opts.lockStaleMs ?? 10_000;
    this.lockTimeoutMs = opts.lockTimeoutMs ?? 5_000;
    this.lockRetryMs = opts.lockRetryMs ?? 25;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }
  // … existing methods …
```

Add the private lock helpers:

```ts
  private async acquireLock(): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      try {
        writeFileSync(this.lockPath, String(process.pid), { flag: "wx", mode: 0o600 });
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
      let mtimeMs: number;
      try {
        mtimeMs = statSync(this.lockPath).mtimeMs;
      } catch {
        continue; // lock vanished between attempts — retry immediately
      }
      if (Date.now() - mtimeMs > this.lockStaleMs) {
        try {
          unlinkSync(this.lockPath); // holder crashed — break the stale lock
        } catch {
          /* another process broke it first */
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `twenty-mcp: timed out waiting for the token-store lock at ${this.lockPath}. ` +
            `If no other twenty-mcp process is running, delete the lock file and retry.`,
        );
      }
      await this.sleep(this.lockRetryMs);
    }
  }

  private releaseLock(): void {
    try {
      unlinkSync(this.lockPath);
    } catch {
      /* already gone */
    }
  }

  private async withLock<T>(fn: () => T): Promise<T> {
    await this.acquireLock();
    try {
      return fn();
    } finally {
      this.releaseLock();
    }
  }
```

Wrap the mutators:

```ts
  async set(label: string, rec: TokenRecord): Promise<void> {
    await this.withLock(() => {
      const all = this.readAll();
      all[label] = this.encrypt(JSON.stringify(rec));
      this.writeAll(all);
    });
  }

  async delete(label: string): Promise<void> {
    await this.withLock(() => {
      const all = this.readAll();
      delete all[label];
      this.writeAll(all);
    });
  }
```

Export the options type from `packages/twenty-core/src/index.ts` (next to the existing tokenStore exports on lines 5–6):

```ts
export type { FileTokenStoreOptions } from "./auth/tokenStore.js";
```

- [ ] **Step 4: Run the full monorepo suite**

Run: `pnpm build && pnpm test`
Expected: PASS across both packages.

- [ ] **Step 5: Commit**

```bash
git add packages/twenty-core/src/auth/tokenStore.ts packages/twenty-core/src/auth/tokenStore.test.ts packages/twenty-core/src/index.ts
git commit -m "fix(core): advisory lockfile serializes FileTokenStore mutations

Closes #9"
```

---

## Phase 2 — API keys in the encrypted store (#16)

### Task 3: `StoredCredential` discriminated union

**Files:**
- Modify: `packages/twenty-core/src/auth/tokenStore.ts`
- Modify: `packages/twenty-core/src/auth/oauthProvider.ts`
- Modify: `packages/twenty-core/src/auth/loginFlow.ts`
- Modify: `packages/twenty-core/src/index.ts`
- Test: `packages/twenty-core/src/auth/tokenStore.test.ts`, `oauthProvider.test.ts`, `loginFlow.test.ts`

**Interfaces:**
- Consumes: `FileTokenStore` from Tasks 1–2.
- Produces (all exported from `twenty-core`):
  ```ts
  export interface OAuthTokenRecord {
    kind: "oauth";
    clientId: string;
    clientSecret?: string;
    tokenEndpoint: string;
    refreshToken: string;
    accessToken?: string;
    expiresAt?: number;
  }
  export interface ApiKeyRecord {
    kind: "apikey";
    apiKey: string;
  }
  export type StoredCredential = OAuthTokenRecord | ApiKeyRecord;
  /** @deprecated Use OAuthTokenRecord. */
  export type TokenRecord = OAuthTokenRecord;
  ```
  `TokenStore.get` returns `Promise<StoredCredential | null>`; `TokenStore.set` takes `StoredCredential`. **Read normalization:** a decrypted record with no `kind` field is returned as `kind: "oauth"` (legacy stores keep working). Task 4–6 write and read `ApiKeyRecord`s through this interface.

- [ ] **Step 1: Write the failing tests**

In `packages/twenty-core/src/auth/tokenStore.test.ts`, change the fixture to the new shape (this drives the compile-level change):

```ts
import { FileTokenStore, type StoredCredential, type TokenRecord } from "./tokenStore.js";

const rec: TokenRecord = {
  kind: "oauth",
  clientId: "cid",
  clientSecret: "csecret",
  tokenEndpoint: "https://crm.example.com/oauth/token",
  refreshToken: "rtok",
  accessToken: "atok",
  expiresAt: 123,
};
```

Add behavior tests:

```ts
describe("FileTokenStore — StoredCredential union", () => {
  it("round-trips an apikey record", async () => {
    const store = new FileTokenStore(dir);
    const keyRec: StoredCredential = { kind: "apikey", apiKey: "sk-123" };
    await store.set("sandbox", keyRec);
    expect(await store.get("sandbox")).toEqual(keyRec);
    const raw = readFileSync(join(dir, "tokens.json"), "utf8");
    expect(raw).not.toContain("sk-123"); // encrypted at rest
  });

  it("normalizes a legacy record without 'kind' to kind: 'oauth' on read", async () => {
    const store = new FileTokenStore(dir);
    // JSON.stringify drops the undefined kind, simulating a pre-union record on disk.
    const legacy = { ...rec, kind: undefined } as unknown as StoredCredential;
    await store.set("legacy", legacy);
    const back = await store.get("legacy");
    expect(back?.kind).toBe("oauth");
    expect(back).toMatchObject({ clientId: "cid", refreshToken: "rtok" });
  });
});
```

In `packages/twenty-core/src/auth/oauthProvider.test.ts`, add `kind: "oauth"` to the `base` fixture, change `memStore` to accept `StoredCredential`, and add:

```ts
it("throws an actionable error when the stored credential is an API key record", async () => {
  const p = new OAuthProvider({ label: "acme", store: memStore({ kind: "apikey", apiKey: "k" }) });
  await expect(p.getBearer()).rejects.toThrow(/API key/i);
});
```

**Union narrowing in existing tests:** vitest transpiles without typechecking, but `pnpm typecheck` will flag union property access. In `oauthProvider.test.ts` and `loginFlow.test.ts`, wherever an existing assertion reads an OAuth-only field off `store.get(...)` / `store.current()` (e.g. `.refreshToken`, `.expiresAt`, `.clientSecret`), narrow with a cast to the alias: `((await store.get("acme")) as TokenRecord).refreshToken` / `const saved = store.current() as TokenRecord;`.

In `packages/twenty-core/src/auth/loginFlow.test.ts`, change `memStore` to `StoredCredential`, add `kind: "oauth"` to the fixture in "reuses stored client credentials…", assert `store.current()!.kind === "oauth"` in the first test, and add:

```ts
it("ignores a stored API-key record when looking for an existing client registration", async () => {
  const store = memStore({ kind: "apikey", apiKey: "k" });
  const d = deps();
  await loginConnection({ label: "acme", baseUrl: "https://x", store, port: 52333 }, d as never);
  expect(d.register).toHaveBeenCalled(); // apikey record is not a client registration
  expect(store.current()!.kind).toBe("oauth"); // overwritten by the OAuth login
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter twenty-core test`
Expected: FAIL — type errors (`kind` not a known property) and the new behavior tests.

- [ ] **Step 3: Implement the union**

In `tokenStore.ts`, replace the `TokenRecord` interface with the union from the Interfaces block above, and update the `TokenStore` interface:

```ts
export interface TokenStore {
  get(label: string): Promise<StoredCredential | null>;
  set(label: string, rec: StoredCredential): Promise<void>;
  delete(label: string): Promise<void>;
  labels(): Promise<string[]>;
}
```

Normalize on read in `FileTokenStore.get` and type `set` over the union:

```ts
  async get(label: string): Promise<StoredCredential | null> {
    const all = this.readAll();
    const blob = all[label];
    if (!blob) return null;
    const parsed = JSON.parse(this.decrypt(blob)) as StoredCredential;
    // Records written before the union have no kind — they are OAuth records.
    return { kind: "oauth", ...parsed };
  }

  async set(label: string, rec: StoredCredential): Promise<void> { /* body unchanged from Task 2 */ }
```

(`{ kind: "oauth", ...parsed }` lets an existing `parsed.kind` win the spread.)

In `oauthProvider.ts`, guard after the null check in `getBearer()`:

```ts
    if (rec.kind !== "oauth") {
      throw new Error(
        `Stored credential for "${this.label}" is an API key, but the connection is ` +
          `configured for OAuth. Run: twenty-mcp login ${this.label}`,
      );
    }
```

In `loginFlow.ts`, narrow the existing-registration lookup (replaces the `const existing = await args.store.get(args.label);` line):

```ts
  const stored = await args.store.get(args.label);
  const existing = stored?.kind === "oauth" ? stored : null;
```

and add `kind: "oauth"` to the `args.store.set(...)` record near the end of `loginConnection`.

In `packages/twenty-core/src/index.ts`, update the type export line:

```ts
export type {
  TokenStore,
  TokenRecord,
  OAuthTokenRecord,
  ApiKeyRecord,
  StoredCredential,
} from "./auth/tokenStore.js";
```

- [ ] **Step 4: Run the full monorepo suite**

Run: `pnpm build && pnpm test`
Expected: PASS. If `twenty-crm-mcp` tests fail on store mocks, they use `vi.fn()` stubs (structurally compatible) — no changes expected.

- [ ] **Step 5: Commit**

```bash
git add packages/twenty-core/src/auth/tokenStore.ts packages/twenty-core/src/auth/oauthProvider.ts packages/twenty-core/src/auth/loginFlow.ts packages/twenty-core/src/index.ts packages/twenty-core/src/auth/*.test.ts
git commit -m "feat(core): StoredCredential union — token store can hold API keys"
```

---

### Task 4: Lazy API-key resolution with env-over-store precedence

**Files:**
- Modify: `packages/twenty-core/src/auth/apiKeyProvider.ts`
- Modify: `packages/twenty-core/src/auth/registry.ts` (the `apikey` branch of `buildConnectionFromConfig`, currently lines 96–110)
- Modify: `packages/twenty-core/src/index.ts`
- Test: `packages/twenty-core/src/auth/apiKeyProvider.test.ts`, `packages/twenty-core/src/auth/registry.test.ts`

**Interfaces:**
- Consumes: `StoredCredential` / `TokenStore` from Task 3; `envKeyForLabel(label)` from `registry.ts`.
- Produces:
  ```ts
  export class StoredApiKeyProvider implements CredentialProvider {
    constructor(label: string, store: TokenStore, envKeyName: string);
    getBearer(): Promise<string>; // stored ApiKeyRecord, or throws actionable error
  }
  ```
  `buildConnectionFromConfig` no longer throws synchronously for a missing API key; the error surfaces on first `getBearer()`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/twenty-core/src/auth/apiKeyProvider.test.ts`:

```ts
import { StoredApiKeyProvider } from "./apiKeyProvider.js";
import type { StoredCredential, TokenStore } from "./tokenStore.js";

function memStore(rec: StoredCredential | null): TokenStore {
  return {
    get: async () => rec,
    set: async () => {},
    delete: async () => {},
    labels: async () => [],
  };
}

describe("StoredApiKeyProvider", () => {
  it("returns the stored API key", async () => {
    const p = new StoredApiKeyProvider(
      "sandbox",
      memStore({ kind: "apikey", apiKey: "sk-123" }),
      "TWENTY_API_KEY_SANDBOX",
    );
    expect(await p.getBearer()).toBe("sk-123");
  });

  it("throws an actionable error naming both remedies when nothing is stored", async () => {
    const p = new StoredApiKeyProvider("sandbox", memStore(null), "TWENTY_API_KEY_SANDBOX");
    await expect(p.getBearer()).rejects.toThrow(/TWENTY_API_KEY_SANDBOX/);
    await expect(p.getBearer()).rejects.toThrow(/twenty-mcp login sandbox/);
  });

  it("throws when the stored record is an OAuth record, not an API key", async () => {
    const p = new StoredApiKeyProvider(
      "sandbox",
      memStore({
        kind: "oauth",
        clientId: "c",
        tokenEndpoint: "https://x/t",
        refreshToken: "r",
      }),
      "TWENTY_API_KEY_SANDBOX",
    );
    await expect(p.getBearer()).rejects.toThrow(/TWENTY_API_KEY_SANDBOX/);
  });
});
```

In `packages/twenty-core/src/auth/registry.test.ts`, update `memStore` to `StoredCredential | null` and **replace** the sync-throw test (lines 69–73) with:

```ts
  it("falls back to a stored API key when no env key is set", async () => {
    const conn = buildConnectionFromConfig(
      "acme-prod",
      registry.connections["acme-prod"],
      {},
      memStore({ kind: "apikey", apiKey: "stored-key" }),
    );
    expect(await conn.getBearer()).toBe("stored-key");
  });

  it("prefers env keys over a stored key", async () => {
    const conn = buildConnectionFromConfig(
      "acme-prod",
      registry.connections["acme-prod"],
      { TWENTY_API_KEY_ACME_PROD: "env-key" },
      memStore({ kind: "apikey", apiKey: "stored-key" }),
    );
    expect(await conn.getBearer()).toBe("env-key");
  });

  it("rejects lazily with an actionable error when no key exists anywhere", async () => {
    const conn = buildConnectionFromConfig(
      "acme-prod",
      registry.connections["acme-prod"],
      {},
      memStore(null),
    );
    await expect(conn.getBearer()).rejects.toThrow(/TWENTY_API_KEY_ACME_PROD/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter twenty-core test src/auth/apiKeyProvider.test.ts src/auth/registry.test.ts`
Expected: FAIL — `StoredApiKeyProvider` doesn't exist; `buildConnectionFromConfig` still throws eagerly.

- [ ] **Step 3: Implement**

Append to `packages/twenty-core/src/auth/apiKeyProvider.ts`:

```ts
import type { TokenStore } from "./tokenStore.js";

/** API key resolved lazily from the encrypted token store (env vars take precedence upstream). */
export class StoredApiKeyProvider implements CredentialProvider {
  constructor(
    private readonly label: string,
    private readonly store: TokenStore,
    private readonly envKeyName: string,
  ) {}

  async getBearer(): Promise<string> {
    const rec = await this.store.get(this.label);
    if (rec?.kind === "apikey") return rec.apiKey;
    throw new Error(
      `No API key for connection "${this.label}". Set ${this.envKeyName} (or TWENTY_API_KEY) ` +
        `in the environment, or store one with: twenty-mcp login ${this.label}`,
    );
  }
}
```

In `registry.ts`, add `StoredApiKeyProvider` to the `apiKeyProvider.js` import and replace the `apikey` branch of `buildConnectionFromConfig` (the `const perLabel …` through `const apiProvider …` block):

```ts
  const perLabel = envKeyForLabel(label);
  const apiKey = env[perLabel]?.trim() || env.TWENTY_API_KEY?.trim();
  const apiProvider = apiKey
    ? new ApiKeyProvider(apiKey)
    : new StoredApiKeyProvider(label, store ?? new FileTokenStore(defaultConfigDir(env)), perLabel);
```

In `packages/twenty-core/src/index.ts`, add `StoredApiKeyProvider` to the value exports (next to wherever `ApiKeyProvider` is exported; if `ApiKeyProvider` is not currently exported, add a new line):

```ts
export { StoredApiKeyProvider } from "./auth/apiKeyProvider.js";
```

- [ ] **Step 4: Run the full monorepo suite**

Run: `pnpm build && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/twenty-core/src/auth/apiKeyProvider.ts packages/twenty-core/src/auth/registry.ts packages/twenty-core/src/index.ts packages/twenty-core/src/auth/apiKeyProvider.test.ts packages/twenty-core/src/auth/registry.test.ts
git commit -m "feat(core): resolve API keys from the encrypted store when env vars are absent"
```

---

### Task 5: `password` prompt + `twenty-mcp login` for apikey connections

**Files:**
- Modify: `packages/twenty-crm-mcp/src/prompts.ts`
- Modify: `packages/twenty-crm-mcp/src/cli.ts`
- Test: `packages/twenty-crm-mcp/src/cli.test.ts`

**Interfaces:**
- Consumes: `StoredCredential` union (Task 3) via `deps.store.set`; the registry's `ConnectionConfig.auth` discriminator.
- Produces:
  - `PromptAPI.password(opts: { message: string; validate?: (v: string) => string | undefined }): Promise<string | symbol>` (backed by `clack.password`), used again in Task 6.
  - `CliDeps.promptApiKey(label: string): Promise<string | null>` — `null` means cancelled/empty.

Run `pnpm --filter twenty-core build` first so the new core types are visible to this package.

- [ ] **Step 1: Write the failing tests**

In `packages/twenty-crm-mcp/src/cli.test.ts`, add `promptApiKey: vi.fn().mockResolvedValue(null)` to the base `deps()` object, then add:

```ts
describe("runCli — login for apikey connections", () => {
  const apikeyRegistry = {
    connections: { sandbox: { baseUrl: "https://dev.acme.com", auth: "apikey" } },
  };

  it("prompts for the key and stores it encrypted", async () => {
    const d = deps({
      loadRegistry: vi.fn().mockReturnValue(apikeyRegistry),
      promptApiKey: vi.fn().mockResolvedValue("sk-123"),
    });
    const code = await runCli(["login", "sandbox"], d as never);
    expect(code).toBe(0);
    expect(d.store.set).toHaveBeenCalledWith("sandbox", { kind: "apikey", apiKey: "sk-123" });
    expect(d.login).not.toHaveBeenCalled();
  });

  it("returns 1 and stores nothing when the prompt is cancelled", async () => {
    const d = deps({
      loadRegistry: vi.fn().mockReturnValue(apikeyRegistry),
      promptApiKey: vi.fn().mockResolvedValue(null),
    });
    const code = await runCli(["login", "sandbox"], d as never);
    expect(code).toBe(1);
    expect(d.store.set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter twenty-core build && pnpm --filter twenty-crm-mcp test src/cli.test.ts`
Expected: FAIL — `runCli` runs the OAuth login flow for the apikey connection (`d.login` called) instead of prompting.

- [ ] **Step 3: Implement**

In `packages/twenty-crm-mcp/src/prompts.ts`, add to the `PromptAPI` interface:

```ts
  password(opts: {
    message: string;
    validate?: (v: string) => string | undefined;
  }): Promise<string | symbol>;
```

and to `clackPrompts()`:

```ts
    password: (opts) =>
      clack.password({
        ...opts,
        validate: opts.validate ? (v) => opts.validate!(v ?? "") : undefined,
      }),
```

In `packages/twenty-crm-mcp/src/cli.ts`:

Add to `CliDeps`:

```ts
  promptApiKey: (label: string) => Promise<string | null>;
```

Add to `realDeps(env)`:

```ts
    promptApiKey: async (label) => {
      const p = clackPrompts();
      const v = await p.password({ message: `API key for "${label}":` });
      if (p.isCancel(v) || !(v as string).trim()) return null;
      return (v as string).trim();
    },
```

In the `login` branch of `runCli`, after the `if (!cfg)` guard and before `await deps.login(...)`:

```ts
    if (cfg.auth === "apikey") {
      const key = await deps.promptApiKey(label);
      if (key === null) {
        deps.err("Cancelled — no API key stored.");
        return 1;
      }
      await deps.store.set(label, { kind: "apikey", apiKey: key });
      deps.out(`Stored API key for "${label}" (encrypted).`);
      return 0;
    }
```

- [ ] **Step 4: Run the package suite**

Run: `pnpm --filter twenty-crm-mcp test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/twenty-crm-mcp/src/prompts.ts packages/twenty-crm-mcp/src/cli.ts packages/twenty-crm-mcp/src/cli.test.ts
git commit -m "feat(cli): 'twenty-mcp login <label>' stores an API key for apikey connections"
```

---

### Task 6: Setup TUI — store-vs-env follow-up for API-key sites

**Files:**
- Modify: `packages/twenty-crm-mcp/src/setup.ts` (the apikey `else` branch of `addSite`, currently lines 327–334; end of `editSite` after `deps.saveRegistry(next)`)
- Test: `packages/twenty-crm-mcp/src/setup.test.ts`

**Interfaces:**
- Consumes: `PromptAPI.password` (Task 5), `deps.store.set` with `ApiKeyRecord` (Task 3), `envKeyForLabel` (already imported in setup.ts).
- Produces: private helper `maybeOfferApiKeyStorage(deps: SetupDeps, label: string): Promise<void>` — offers storage unless an `ApiKeyRecord` is already stored for the label; on decline/cancel falls back to the existing env-var note.

- [ ] **Step 1: Update the fake and write the failing tests**

In `packages/twenty-crm-mcp/src/setup.test.ts`:

1. Add `password: async () => next(),` to the `fakePrompts` api object.
2. The existing test "adds an apikey site without calling login" gains one answer for the new select — change its answers to `["add", "sandbox", "https://dev.acme.com", "apikey", "env", "done"]`.
3. Add new tests:

```ts
describe("runSetup — API key storage", () => {
  it("stores the API key encrypted when the user chooses 'store'", async () => {
    const { d } = deps([
      "add", "sandbox", "https://dev.acme.com", "apikey", "store", "sk-123", "done",
    ]);
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(d.store.set).toHaveBeenCalledWith("sandbox", { kind: "apikey", apiKey: "sk-123" });
  });

  it("keeps the env-var path when the user chooses 'env'", async () => {
    const { d } = deps(["add", "sandbox", "https://dev.acme.com", "apikey", "env", "done"]);
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(d.store.set).not.toHaveBeenCalled();
  });

  it("stores nothing when the key prompt is cancelled", async () => {
    // queue ends after "store": the password prompt (and everything later) cancels
    const { d } = deps(["add", "sandbox", "https://dev.acme.com", "apikey", "store"]);
    await runSetup(d as never);
    expect(d.store.set).not.toHaveBeenCalled();
  });

  it("does not re-offer storage when a key is already stored for the label", async () => {
    const { d } = deps(["add", "sandbox", "https://dev.acme.com", "apikey", "done"], {
      store: {
        get: vi.fn().mockResolvedValue({ kind: "apikey", apiKey: "old" }),
        set: vi.fn(),
        delete: vi.fn().mockResolvedValue(undefined),
        labels: vi.fn().mockResolvedValue([]),
      },
    });
    const code = await runSetup(d as never);
    expect(code).toBe(0); // no extra select consumed — "done" lands on the menu
    expect(d.store.set).not.toHaveBeenCalled();
  });

  it("edit offers key storage when switching a connection to apikey", async () => {
    const { d } = deps(
      // menu:edit, pick:acme, label(keep), url(keep), auth:apikey, store, key, menu:done
      ["edit", "acme", "acme", "https://crm.acme.com", "apikey", "store", "sk-456", "done"],
      {
        loadRegistry: () => ({
          connections: { acme: { baseUrl: "https://crm.acme.com", auth: "oauth" } },
        }),
      },
    );
    const code = await runSetup(d as never);
    expect(code).toBe(0);
    expect(d.store.set).toHaveBeenCalledWith("acme", { kind: "apikey", apiKey: "sk-456" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter twenty-crm-mcp test src/setup.test.ts`
Expected: FAIL — the new tests find no store/env select (answers consumed by the wrong prompts), and `d.store.set` is never called.

- [ ] **Step 3: Implement**

In `packages/twenty-crm-mcp/src/setup.ts`, add the helper (near `addSite`):

```ts
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
```

In `addSite`, replace the whole `} else { p.note(…) }` apikey branch with:

```ts
  } else {
    await maybeOfferApiKeyStorage(deps, label as string);
  }
```

In `editSite`, after `deps.saveRegistry(next);` and before `return next;`:

```ts
  if (cfg.auth === "apikey") {
    await maybeOfferApiKeyStorage(deps, label);
  }
```

- [ ] **Step 4: Run the package suite**

Run: `pnpm --filter twenty-crm-mcp test`
Expected: PASS (including the pre-existing setup tests with the adjusted answer queues).

- [ ] **Step 5: Commit**

```bash
git add packages/twenty-crm-mcp/src/setup.ts packages/twenty-crm-mcp/src/setup.test.ts
git commit -m "feat(setup): offer encrypted API-key storage in add/edit flows"
```

---

### Task 7: Documentation + ledger

**Files:**
- Modify: `AGENTS.md`
- Modify: any README / docs-site pages describing env-only API keys (locate with the grep below)
- Modify: `docs/superpowers/specs/2026-07-01-setup-command-design.md` (one-line pointer)
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:** none — prose only. The canonical description to use everywhere:

> API keys resolve in order: `TWENTY_API_KEY_<LABEL>` → `TWENTY_API_KEY` → the encrypted token store. Store a key with `twenty-mcp login <label>` (or during `twenty-mcp setup`); env vars always take precedence. The connection registry itself never stores secrets.

- [ ] **Step 1: Locate every doc that claims env-only keys**

Run: `grep -rn "TWENTY_API_KEY" README.md AGENTS.md apps/docs packages/twenty-crm-mcp/README.md packages/twenty-core/README.md 2>/dev/null | grep -v dist | grep -v node_modules`

- [ ] **Step 2: Update AGENTS.md**

In the "Authentication & connections" section, change the API-key bullet to:

```markdown
- **API key:** `TWENTY_BASE_URL` + `TWENTY_API_KEY` (legacy single-instance), per-connection
  `TWENTY_API_KEY_<LABEL>` env vars, or a key stored encrypted in the token store
  (`twenty-mcp login <label>` / setup). Env vars take precedence over the stored key.
```

and change the registry sentence at the end of that section to:

```markdown
The registry file **never stores secrets** — API keys live in env vars or the encrypted
token store, OAuth tokens in the encrypted store.
```

- [ ] **Step 3: Update the other hits from Step 1**

Apply the canonical description (blockquote above) to each README / docs-site page found — typically the setup/connections pages under `apps/docs`. Keep each page's existing voice and formatting; state the precedence order explicitly wherever env vars are currently described as the only option.

- [ ] **Step 4: Pointer in the superseded spec**

In `docs/superpowers/specs/2026-07-01-setup-command-design.md`, at the end of the "Credential policy (unchanged by this feature)" section, add:

```markdown
> **Superseded (2026-07-01):** API keys may now also be stored in the encrypted token
> store — see `2026-07-01-token-store-locking-and-api-keys-design.md`. Env vars still
> take precedence.
```

- [ ] **Step 5: Ledger entry**

Append to `.superpowers/sdd/progress.md`, following the file's existing entry format, a summary of this plan: FileTokenStore atomic writes + advisory lockfile (#9); StoredCredential union, StoredApiKeyProvider with env-over-store precedence, login/setup key entry (#16); note that the lock is advisory and cross-process only.

- [ ] **Step 6: Verify and commit**

Run: `pnpm build && pnpm test && pnpm docs:build`
Expected: PASS / docs build clean.

```bash
git add AGENTS.md README.md apps/docs docs/superpowers/specs/2026-07-01-setup-command-design.md .superpowers/sdd/progress.md packages/twenty-crm-mcp/README.md packages/twenty-core/README.md
git commit -m "docs: API keys can resolve from the encrypted store; env vars take precedence

Closes #16"
```

---

## Final verification

- [ ] `pnpm build && pnpm test && pnpm typecheck && pnpm check` — all green.
- [ ] Manual smoke (optional, live instance): `twenty-mcp setup` → add an apikey site → choose "Store it encrypted now" → start the MCP server with no `TWENTY_API_KEY*` env → a tool call succeeds.
