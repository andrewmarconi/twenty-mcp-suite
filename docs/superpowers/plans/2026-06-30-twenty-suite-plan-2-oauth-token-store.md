# Twenty Suite — Plan 2: OAuth Sign-In + Token Store + Setup CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a single operator sign in to a self-hosted Twenty instance via browser OAuth (acting as their own user, inheriting their Twenty role) instead of pasting an API key, and manage several instances as named connections — all on the existing `npx`/stdio server, with refresh tokens stored encrypted on disk.

**Architecture:** Builds entirely on Plan 1's auth seam. A new `OAuthProvider` implements the same `CredentialProvider.getBearer()` contract as `ApiKeyProvider`, so the transport clients and server are untouched. OAuth uses Twenty's RFC 7591 dynamic client registration + Authorization-Code-with-PKCE via a loopback redirect; a `twenty-mcp` setup CLI runs the one-time interactive browser flow and persists an encrypted refresh token. `resolveActiveConnection` gains a disk registry-file loader so `auth: "oauth"` connections resolve to a live, auto-refreshing bearer.

**Tech Stack:** TypeScript ESM; **zero new runtime dependencies** — PKCE + AES-256-GCM via `node:crypto`, loopback listener via `node:http`, browser launch via `node:child_process`, HTTP via global `fetch`. vitest for tests.

## Global Constraints

- Node `>=20`; ESM only; **`.js` import extensions** on local imports.
- Package manager **pnpm**; bare `pnpm add` under the age guard — but this plan adds **no dependencies**. If a task believes it needs one, STOP and escalate.
- **stdout is reserved for the MCP protocol.** The server (`index.ts`) must never print to stdout. The **CLI** (`twenty-mcp`) is a separate binary and MAY print to stdout freely (it is not an MCP server).
- **Never log or persist a token, client secret, or API key in plaintext to stdout/stderr or to any unencrypted file.** The only at-rest secrets live in the encrypted token store.
- **Token store:** AES-256-GCM encrypted file under the config dir (`XDG_CONFIG_HOME` or `~/.config` → `twenty-mcp/`), master key in a sibling `store.key` file created mode `0600`. No native dependencies.
- **Twenty OAuth wire facts (verified against docs; the one open item is confirmed in Task 9's live check):**
  - Register: `POST {baseUrl}/oauth/register` JSON `{ client_name, redirect_uris, grant_types: ["authorization_code","refresh_token"], token_endpoint_auth_method: "client_secret_post" }` → `{ client_id, client_secret }` (secret returned once).
  - Authorize: `GET {baseUrl}/oauth/authorize?client_id&response_type=code&redirect_uri&scope=api&state&code_challenge&code_challenge_method=S256`.
  - Token (exchange): `POST {baseUrl}/oauth/token` form-urlencoded `grant_type=authorization_code&code&redirect_uri&client_id&client_secret&code_verifier` → `{ access_token, token_type, expires_in, refresh_token }`.
  - Token (refresh): `POST {baseUrl}/oauth/token` form-urlencoded `grant_type=refresh_token&refresh_token&client_id&client_secret` → `{ access_token, expires_in, refresh_token? }`.
  - The access token is used exactly like an API key: `Authorization: Bearer <access_token>`.
- **`twenty-core` remains bundle-only** (its `exports` points at raw `./src/index.ts`; consumers bundle via tsup `noExternal`). Both `twenty-crm-mcp` entries (server + CLI) bundle it, so this holds. Do not add a non-bundling consumer of `twenty-core` in this plan.
- **Out of scope (later work):** the in-session `switch_connection` tool (runtime instance-swapping needs schema-cache invalidation + client rebinding); profiles/recipes/CRM curation (Plan 3); publish-prep doc fixes.

---

### Task 1: PKCE helpers

**Files:**
- Create: `packages/twenty-core/src/auth/pkce.ts`
- Test: `packages/twenty-core/src/auth/pkce.test.ts`
- Modify: `packages/twenty-core/src/index.ts` (export)

**Interfaces:**
- Consumes: `node:crypto`.
- Produces: `generateCodeVerifier(): string` (43–128 char base64url), `codeChallengeS256(verifier: string): string` (base64url SHA-256 of the ASCII verifier).

- [ ] **Step 1: Write the failing test**

Create `packages/twenty-core/src/auth/pkce.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { generateCodeVerifier, codeChallengeS256 } from "./pkce.js";

describe("pkce", () => {
  it("generates a base64url verifier of legal length (43-128 chars, no +/= )", () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("produces two different verifiers on successive calls", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });

  it("computes the S256 challenge as base64url(sha256(verifier))", () => {
    const verifier = "test-verifier-string-1234567890-abcdefghij";
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(codeChallengeS256(verifier)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter twenty-core test src/auth/pkce.test.ts`
Expected: FAIL — cannot resolve `./pkce.js`.

- [ ] **Step 3: Implement**

Create `packages/twenty-core/src/auth/pkce.ts`:

```ts
import { randomBytes, createHash } from "node:crypto";

/** RFC 7636 code verifier: 32 random bytes as base64url (43 chars). */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** RFC 7636 S256 challenge: base64url(SHA-256(verifier)). */
export function codeChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
```

- [ ] **Step 4: Export from the barrel**

Add to `packages/twenty-core/src/index.ts`:

```ts
export { generateCodeVerifier, codeChallengeS256 } from "./auth/pkce.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter twenty-core test src/auth/pkce.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): PKCE code verifier + S256 challenge helpers"
```

---

### Task 2: Encrypted token store

**Files:**
- Create: `packages/twenty-core/src/auth/tokenStore.ts`
- Test: `packages/twenty-core/src/auth/tokenStore.test.ts`
- Modify: `packages/twenty-core/src/index.ts` (exports)

**Interfaces:**
- Consumes: `node:crypto`, `node:fs`, `node:path`, `node:os`.
- Produces:
  - `interface TokenRecord { clientId: string; clientSecret: string; refreshToken: string; accessToken?: string; expiresAt?: number }`
  - `interface TokenStore { get(label: string): Promise<TokenRecord | null>; set(label: string, rec: TokenRecord): Promise<void>; delete(label: string): Promise<void>; labels(): Promise<string[]> }`
  - `class FileTokenStore implements TokenStore` with `constructor(dir: string)` — AES-256-GCM per-record, master key at `${dir}/store.key` (mode `0600`), records at `${dir}/tokens.json` as `{ [label]: { iv, tag, ct } }` (all base64).
  - `function defaultConfigDir(env?: NodeJS.ProcessEnv): string` → `${XDG_CONFIG_HOME||~/.config}/twenty-mcp`.

- [ ] **Step 1: Write the failing test**

Create `packages/twenty-core/src/auth/tokenStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTokenStore, type TokenRecord } from "./tokenStore.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "twenty-store-"));
});

const rec: TokenRecord = {
  clientId: "cid",
  clientSecret: "csecret",
  refreshToken: "rtok",
  accessToken: "atok",
  expiresAt: 123,
};

describe("FileTokenStore", () => {
  it("round-trips a record and returns null for unknown labels", async () => {
    const store = new FileTokenStore(dir);
    expect(await store.get("acme")).toBeNull();
    await store.set("acme", rec);
    expect(await store.get("acme")).toEqual(rec);
  });

  it("persists ciphertext, not plaintext secrets, on disk", async () => {
    const store = new FileTokenStore(dir);
    await store.set("acme", rec);
    const raw = readFileSync(join(dir, "tokens.json"), "utf8");
    expect(raw).not.toContain("rtok");
    expect(raw).not.toContain("csecret");
  });

  it("creates the key file with 0600 permissions", async () => {
    const store = new FileTokenStore(dir);
    await store.set("acme", rec);
    const mode = statSync(join(dir, "store.key")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("lists and deletes labels", async () => {
    const store = new FileTokenStore(dir);
    await store.set("a", rec);
    await store.set("b", rec);
    expect((await store.labels()).sort()).toEqual(["a", "b"]);
    await store.delete("a");
    expect(await store.get("a")).toBeNull();
    expect((await store.labels())).toEqual(["b"]);
  });

  it("a second store instance on the same dir decrypts existing records", async () => {
    await new FileTokenStore(dir).set("acme", rec);
    expect(await new FileTokenStore(dir).get("acme")).toEqual(rec);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter twenty-core test src/auth/tokenStore.test.ts`
Expected: FAIL — cannot resolve `./tokenStore.js`.

- [ ] **Step 3: Implement**

Create `packages/twenty-core/src/auth/tokenStore.ts`:

```ts
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TokenRecord {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
}

export interface TokenStore {
  get(label: string): Promise<TokenRecord | null>;
  set(label: string, rec: TokenRecord): Promise<void>;
  delete(label: string): Promise<void>;
  labels(): Promise<string[]>;
}

interface Blob {
  iv: string;
  tag: string;
  ct: string;
}

export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "twenty-mcp");
}

export class FileTokenStore implements TokenStore {
  private readonly keyPath: string;
  private readonly dataPath: string;

  constructor(private readonly dir: string) {
    this.keyPath = join(dir, "store.key");
    this.dataPath = join(dir, "tokens.json");
  }

  async get(label: string): Promise<TokenRecord | null> {
    const all = this.readAll();
    const blob = all[label];
    if (!blob) return null;
    return JSON.parse(this.decrypt(blob)) as TokenRecord;
  }

  async set(label: string, rec: TokenRecord): Promise<void> {
    const all = this.readAll();
    all[label] = this.encrypt(JSON.stringify(rec));
    this.writeAll(all);
  }

  async delete(label: string): Promise<void> {
    const all = this.readAll();
    delete all[label];
    this.writeAll(all);
  }

  async labels(): Promise<string[]> {
    return Object.keys(this.readAll());
  }

  private key(): Buffer {
    mkdirSync(this.dir, { recursive: true });
    if (!existsSync(this.keyPath)) {
      writeFileSync(this.keyPath, randomBytes(32), { mode: 0o600 });
    }
    return readFileSync(this.keyPath);
  }

  private encrypt(plaintext: string): Blob {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ct: ct.toString("base64"),
    };
  }

  private decrypt(blob: Blob): string {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key(),
      Buffer.from(blob.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(blob.ct, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  private readAll(): Record<string, Blob> {
    if (!existsSync(this.dataPath)) return {};
    return JSON.parse(readFileSync(this.dataPath, "utf8")) as Record<string, Blob>;
  }

  private writeAll(all: Record<string, Blob>): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.dataPath, JSON.stringify(all, null, 2), { mode: 0o600 });
  }
}
```

- [ ] **Step 4: Export from the barrel**

Add to `packages/twenty-core/src/index.ts`:

```ts
export { FileTokenStore, defaultConfigDir } from "./auth/tokenStore.js";
export type { TokenStore, TokenRecord } from "./auth/tokenStore.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter twenty-core test src/auth/tokenStore.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): AES-256-GCM encrypted file token store"
```

---

### Task 3: OAuth HTTP client (register / exchange / refresh)

**Files:**
- Create: `packages/twenty-core/src/auth/oauthClient.ts`
- Test: `packages/twenty-core/src/auth/oauthClient.test.ts`
- Modify: `packages/twenty-core/src/index.ts` (exports)

**Interfaces:**
- Consumes: global `fetch`, `TwentyApiError` (from `../twenty/errors.js`).
- Produces (all take an injectable `fetchImpl: typeof fetch = fetch`):
  - `registerClient(baseUrl: string, redirectUri: string, fetchImpl?): Promise<{ clientId: string; clientSecret: string }>`
  - `exchangeCode(args: { baseUrl: string; clientId: string; clientSecret: string; code: string; redirectUri: string; codeVerifier: string }, fetchImpl?): Promise<TokenResponse>`
  - `refreshToken(args: { baseUrl: string; clientId: string; clientSecret: string; refreshToken: string }, fetchImpl?): Promise<TokenResponse>`
  - `interface TokenResponse { accessToken: string; refreshToken?: string; expiresIn?: number }`
  - `buildAuthorizeUrl(args: { baseUrl: string; clientId: string; redirectUri: string; state: string; codeChallenge: string; scope?: string }): string`

- [ ] **Step 1: Write the failing test**

Create `packages/twenty-core/src/auth/oauthClient.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  registerClient,
  exchangeCode,
  refreshToken,
  buildAuthorizeUrl,
} from "./oauthClient.js";

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("oauthClient", () => {
  it("registers a client with the loopback redirect and confidential auth method", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonRes(200, { client_id: "cid", client_secret: "csec" }));
    const out = await registerClient(
      "https://crm.example.com",
      "http://localhost:52333/callback",
      fetchImpl as unknown as typeof fetch,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://crm.example.com/oauth/register");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.redirect_uris).toEqual(["http://localhost:52333/callback"]);
    expect(body.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(body.token_endpoint_auth_method).toBe("client_secret_post");
    expect(out).toEqual({ clientId: "cid", clientSecret: "csec" });
  });

  it("exchanges a code as form-urlencoded and normalizes the token response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonRes(200, { access_token: "at", refresh_token: "rt", expires_in: 3600 }),
    );
    const out = await exchangeCode(
      {
        baseUrl: "https://crm.example.com",
        clientId: "cid",
        clientSecret: "csec",
        code: "authcode",
        redirectUri: "http://localhost:52333/callback",
        codeVerifier: "verifier",
      },
      fetchImpl as unknown as typeof fetch,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://crm.example.com/oauth/token");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const params = new URLSearchParams(init.body as string);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("authcode");
    expect(params.get("client_secret")).toBe("csec");
    expect(params.get("code_verifier")).toBe("verifier");
    expect(out).toEqual({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 });
  });

  it("refreshes using the refresh_token grant", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonRes(200, { access_token: "at2", expires_in: 3600 }));
    const out = await refreshToken(
      {
        baseUrl: "https://crm.example.com",
        clientId: "cid",
        clientSecret: "csec",
        refreshToken: "rt",
      },
      fetchImpl as unknown as typeof fetch,
    );
    const params = new URLSearchParams(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("rt");
    expect(out.accessToken).toBe("at2");
  });

  it("throws TwentyApiError on a non-2xx token response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(401, { error: "invalid_grant" }));
    await expect(
      refreshToken(
        { baseUrl: "https://x", clientId: "c", clientSecret: "s", refreshToken: "r" },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("builds an authorize URL with PKCE S256 and the api scope", () => {
    const url = buildAuthorizeUrl({
      baseUrl: "https://crm.example.com",
      clientId: "cid",
      redirectUri: "http://localhost:52333/callback",
      state: "st",
      codeChallenge: "chal",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://crm.example.com/oauth/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("api");
    expect(u.searchParams.get("code_challenge")).toBe("chal");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBe("st");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter twenty-core test src/auth/oauthClient.test.ts`
Expected: FAIL — cannot resolve `./oauthClient.js`.

- [ ] **Step 3: Implement**

Create `packages/twenty-core/src/auth/oauthClient.ts`:

```ts
import { TwentyApiError } from "../twenty/errors.js";

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function postForm(
  url: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  const parsed = text ? safeJson(text) : {};
  if (!res.ok) {
    throw new TwentyApiError(`Twenty OAuth token request failed (${res.status})`, res.status, parsed, url);
  }
  const b = parsed as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!b.access_token) {
    throw new TwentyApiError("Twenty OAuth token response had no access_token", res.status, parsed, url);
  }
  return { accessToken: b.access_token, refreshToken: b.refresh_token, expiresIn: b.expires_in };
}

export async function registerClient(
  baseUrl: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ clientId: string; clientSecret: string }> {
  const url = `${stripSlash(baseUrl)}/oauth/register`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "twenty-crm-mcp",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "client_secret_post",
    }),
  });
  const text = await res.text();
  const parsed = text ? safeJson(text) : {};
  if (!res.ok) {
    throw new TwentyApiError(`Twenty OAuth client registration failed (${res.status})`, res.status, parsed, url);
  }
  const b = parsed as { client_id?: string; client_secret?: string };
  if (!b.client_id || !b.client_secret) {
    throw new TwentyApiError("Twenty OAuth registration response missing client credentials", res.status, parsed, url);
  }
  return { clientId: b.client_id, clientSecret: b.client_secret };
}

export function buildAuthorizeUrl(args: {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
}): string {
  const u = new URL(`${stripSlash(args.baseUrl)}/oauth/authorize`);
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("scope", args.scope ?? "api");
  u.searchParams.set("state", args.state);
  u.searchParams.set("code_challenge", args.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export function exchangeCode(
  args: {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  return postForm(
    `${stripSlash(args.baseUrl)}/oauth/token`,
    {
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code_verifier: args.codeVerifier,
    },
    fetchImpl,
  );
}

export function refreshToken(
  args: { baseUrl: string; clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  return postForm(
    `${stripSlash(args.baseUrl)}/oauth/token`,
    {
      grant_type: "refresh_token",
      refresh_token: args.refreshToken,
      client_id: args.clientId,
      client_secret: args.clientSecret,
    },
    fetchImpl,
  );
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
```

- [ ] **Step 4: Export from the barrel**

Add to `packages/twenty-core/src/index.ts`:

```ts
export {
  registerClient,
  buildAuthorizeUrl,
  exchangeCode,
  refreshToken,
} from "./auth/oauthClient.js";
export type { TokenResponse } from "./auth/oauthClient.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter twenty-core test src/auth/oauthClient.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): Twenty OAuth HTTP client (register/authorize/exchange/refresh)"
```

---

### Task 4: OAuthProvider (auto-refreshing credential provider)

**Files:**
- Create: `packages/twenty-core/src/auth/oauthProvider.ts`
- Test: `packages/twenty-core/src/auth/oauthProvider.test.ts`
- Modify: `packages/twenty-core/src/index.ts` (exports)

**Interfaces:**
- Consumes: `CredentialProvider` (`./types.js`), `TokenStore`/`TokenRecord` (`./tokenStore.js`), `refreshToken` (`./oauthClient.js`).
- Produces: `class OAuthProvider implements CredentialProvider` with
  `constructor(args: { label: string; baseUrl: string; store: TokenStore; now?: () => number; refreshFn?: typeof refreshToken; skewMs?: number })`
  and `getBearer(): Promise<string>` — returns a live access token, refreshing (and persisting the rotated tokens) when expired or absent; throws an actionable "run `twenty-mcp login <label>`" error when no record exists.

- [ ] **Step 1: Write the failing test**

Create `packages/twenty-core/src/auth/oauthProvider.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { OAuthProvider } from "./oauthProvider.js";
import type { TokenRecord, TokenStore } from "./tokenStore.js";

function memStore(initial?: TokenRecord): TokenStore {
  let rec = initial ?? null;
  return {
    get: async () => rec,
    set: async (_l, r) => {
      rec = r;
    },
    delete: async () => {
      rec = null;
    },
    labels: async () => (rec ? ["acme"] : []),
  };
}

const base: TokenRecord = {
  clientId: "cid",
  clientSecret: "csec",
  refreshToken: "rt",
};

describe("OAuthProvider", () => {
  it("throws an actionable login hint when no record is stored", async () => {
    const p = new OAuthProvider({ label: "acme", baseUrl: "https://x", store: memStore() });
    await expect(p.getBearer()).rejects.toThrow(/twenty-mcp login acme/);
  });

  it("returns a cached, unexpired access token without refreshing", async () => {
    const refreshFn = vi.fn();
    const store = memStore({ ...base, accessToken: "good", expiresAt: 50_000 });
    const p = new OAuthProvider({
      label: "acme",
      baseUrl: "https://x",
      store,
      now: () => 5_000,
      refreshFn: refreshFn as never,
    });
    expect(await p.getBearer()).toBe("good");
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it("refreshes when the access token is expired and persists the rotated tokens", async () => {
    const refreshFn = vi
      .fn()
      .mockResolvedValue({ accessToken: "fresh", refreshToken: "rt2", expiresIn: 3600 });
    const store = memStore({ ...base, accessToken: "stale", expiresAt: 1_000 });
    const setSpy = vi.spyOn(store, "set");
    const p = new OAuthProvider({
      label: "acme",
      baseUrl: "https://x",
      store,
      now: () => 5_000,
      refreshFn: refreshFn as never,
    });
    expect(await p.getBearer()).toBe("fresh");
    expect(refreshFn).toHaveBeenCalledWith({
      baseUrl: "https://x",
      clientId: "cid",
      clientSecret: "csec",
      refreshToken: "rt",
    });
    expect(setSpy).toHaveBeenCalled();
    // rotated refresh token persisted
    expect((await store.get("acme"))!.refreshToken).toBe("rt2");
  });

  it("refreshes when there is a refresh token but no access token yet", async () => {
    const refreshFn = vi
      .fn()
      .mockResolvedValue({ accessToken: "fresh", expiresIn: 3600 });
    const p = new OAuthProvider({
      label: "acme",
      baseUrl: "https://x",
      store: memStore({ ...base }),
      now: () => 0,
      refreshFn: refreshFn as never,
    });
    expect(await p.getBearer()).toBe("fresh");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter twenty-core test src/auth/oauthProvider.test.ts`
Expected: FAIL — cannot resolve `./oauthProvider.js`.

- [ ] **Step 3: Implement**

Create `packages/twenty-core/src/auth/oauthProvider.ts`:

```ts
import type { CredentialProvider } from "./types.js";
import type { TokenStore } from "./tokenStore.js";
import { refreshToken as defaultRefresh } from "./oauthClient.js";

export class OAuthProvider implements CredentialProvider {
  private readonly label: string;
  private readonly baseUrl: string;
  private readonly store: TokenStore;
  private readonly now: () => number;
  private readonly refreshFn: typeof defaultRefresh;
  private readonly skewMs: number;

  constructor(args: {
    label: string;
    baseUrl: string;
    store: TokenStore;
    now?: () => number;
    refreshFn?: typeof defaultRefresh;
    skewMs?: number;
  }) {
    this.label = args.label;
    this.baseUrl = args.baseUrl;
    this.store = args.store;
    this.now = args.now ?? (() => Date.now());
    this.refreshFn = args.refreshFn ?? defaultRefresh;
    this.skewMs = args.skewMs ?? 30_000;
  }

  async getBearer(): Promise<string> {
    const rec = await this.store.get(this.label);
    if (!rec) {
      throw new Error(
        `Not signed in to connection "${this.label}". Run: twenty-mcp login ${this.label}`,
      );
    }
    if (rec.accessToken && rec.expiresAt && this.now() < rec.expiresAt - this.skewMs) {
      return rec.accessToken;
    }
    const tokens = await this.refreshFn({
      baseUrl: this.baseUrl,
      clientId: rec.clientId,
      clientSecret: rec.clientSecret,
      refreshToken: rec.refreshToken,
    });
    const expiresAt = tokens.expiresIn ? this.now() + tokens.expiresIn * 1000 : undefined;
    await this.store.set(this.label, {
      ...rec,
      refreshToken: tokens.refreshToken ?? rec.refreshToken,
      accessToken: tokens.accessToken,
      expiresAt,
    });
    return tokens.accessToken;
  }
}
```

- [ ] **Step 4: Export from the barrel**

Add to `packages/twenty-core/src/index.ts`:

```ts
export { OAuthProvider } from "./auth/oauthProvider.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter twenty-core test src/auth/oauthProvider.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): OAuthProvider with cached access token + refresh-on-expiry"
```

---

### Task 5: Loopback callback listener + browser launch

**Files:**
- Create: `packages/twenty-core/src/auth/loopback.ts`
- Test: `packages/twenty-core/src/auth/loopback.test.ts`
- Modify: `packages/twenty-core/src/index.ts` (exports)

**Interfaces:**
- Consumes: `node:http`, `node:child_process`.
- Produces:
  - `parseCallback(reqUrl: string): { code?: string; state?: string; error?: string }` (pure — parses the callback query).
  - `interface LoopbackServer { redirectUri: string; waitForCode(expectedState: string): Promise<string>; close(): void }`
  - `startLoopback(port: number): Promise<LoopbackServer>` — binds `127.0.0.1:port`, resolves the browser to a "you can close this tab" page, and `waitForCode` resolves with the `code` when `state` matches (rejects on mismatch or an `error` param).
  - `openBrowser(url: string): void` — spawns the platform opener (`open`/`xdg-open`/`start`), detached; failure is swallowed (the CLI also prints the URL).

Only `parseCallback` is unit-tested here; `startLoopback`/`openBrowser` are exercised by the Task 9 manual live check (they are thin wrappers over Node built-ins and a child process).

- [ ] **Step 1: Write the failing test**

Create `packages/twenty-core/src/auth/loopback.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCallback } from "./loopback.js";

describe("parseCallback", () => {
  it("extracts code and state from the callback path", () => {
    expect(parseCallback("/callback?code=abc&state=xyz")).toEqual({
      code: "abc",
      state: "xyz",
    });
  });

  it("surfaces an OAuth error param", () => {
    expect(parseCallback("/callback?error=access_denied")).toEqual({
      error: "access_denied",
    });
  });

  it("returns empty fields for an unrelated path", () => {
    expect(parseCallback("/favicon.ico")).toEqual({});
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter twenty-core test src/auth/loopback.test.ts`
Expected: FAIL — cannot resolve `./loopback.js`.

- [ ] **Step 3: Implement**

Create `packages/twenty-core/src/auth/loopback.ts`:

```ts
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { platform } from "node:os";

export function parseCallback(reqUrl: string): {
  code?: string;
  state?: string;
  error?: string;
} {
  const u = new URL(reqUrl, "http://localhost");
  const out: { code?: string; state?: string; error?: string } = {};
  const error = u.searchParams.get("error");
  if (error) out.error = error;
  const code = u.searchParams.get("code");
  if (code) out.code = code;
  const state = u.searchParams.get("state");
  if (state) out.state = state;
  return out;
}

export interface LoopbackServer {
  redirectUri: string;
  waitForCode(expectedState: string): Promise<string>;
  close(): void;
}

export function startLoopback(port: number): Promise<LoopbackServer> {
  return new Promise((resolve, reject) => {
    let onResult: ((r: { code?: string; state?: string; error?: string }) => void) | null = null;

    const server: Server = createServer((req, res) => {
      const result = parseCallback(req.url ?? "");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>Sign-in complete. You can close this tab.</body></html>");
      onResult?.(result);
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        redirectUri: `http://localhost:${port}/callback`,
        waitForCode(expectedState: string): Promise<string> {
          return new Promise((res, rej) => {
            onResult = (r) => {
              if (r.error) return rej(new Error(`OAuth error: ${r.error}`));
              if (!r.code) return; // ignore stray requests (favicon, etc.)
              if (r.state !== expectedState) return rej(new Error("OAuth state mismatch"));
              res(r.code);
            };
          });
        },
        close: () => server.close(),
      });
    });
  });
}

export function openBrowser(url: string): void {
  const cmd =
    platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true, shell: platform() === "win32" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Non-fatal: the CLI also prints the URL for manual opening.
  }
}
```

- [ ] **Step 4: Export from the barrel**

Add to `packages/twenty-core/src/index.ts`:

```ts
export { parseCallback, startLoopback, openBrowser } from "./auth/loopback.js";
export type { LoopbackServer } from "./auth/loopback.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter twenty-core test src/auth/loopback.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): loopback OAuth callback listener + browser launcher"
```

---

### Task 6: Login flow orchestration

**Files:**
- Create: `packages/twenty-core/src/auth/loginFlow.ts`
- Test: `packages/twenty-core/src/auth/loginFlow.test.ts`
- Modify: `packages/twenty-core/src/index.ts` (exports)

**Interfaces:**
- Consumes: `pkce`, `oauthClient`, `loopback`, `TokenStore`, `node:crypto` (state).
- Produces: `loginConnection(args, deps?): Promise<void>` where
  `args = { label: string; baseUrl: string; store: TokenStore; port?: number }` and `deps` injects `{ register, exchange, startLoopback, openBrowser, generateVerifier, challenge, makeState, log }` (all defaulting to the real implementations). Orchestrates: reuse stored client creds or `register` a new client with the loopback redirect → PKCE + state → start loopback → open browser (and log the URL) → await the code with state check → `exchange` → persist a `TokenRecord`.

- [ ] **Step 1: Write the failing test**

Create `packages/twenty-core/src/auth/loginFlow.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { loginConnection } from "./loginFlow.js";
import type { TokenRecord, TokenStore } from "./tokenStore.js";

function memStore(initial?: TokenRecord): TokenStore & { current: () => TokenRecord | null } {
  let rec = initial ?? null;
  return {
    get: async () => rec,
    set: async (_l, r) => {
      rec = r;
    },
    delete: async () => {
      rec = null;
    },
    labels: async () => (rec ? ["acme"] : []),
    current: () => rec,
  };
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    register: vi.fn().mockResolvedValue({ clientId: "cid", clientSecret: "csec" }),
    exchange: vi.fn().mockResolvedValue({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 }),
    startLoopback: vi.fn().mockResolvedValue({
      redirectUri: "http://localhost:52333/callback",
      waitForCode: vi.fn().mockResolvedValue("authcode"),
      close: vi.fn(),
    }),
    openBrowser: vi.fn(),
    generateVerifier: () => "verifier",
    challenge: () => "challenge",
    makeState: () => "state123",
    log: vi.fn(),
    ...overrides,
  };
}

describe("loginConnection", () => {
  it("registers a client, runs the flow, and persists the refresh token", async () => {
    const store = memStore();
    const d = deps();
    await loginConnection({ label: "acme", baseUrl: "https://crm.example.com", store, port: 52333 }, d as never);

    expect(d.register).toHaveBeenCalledWith(
      "https://crm.example.com",
      "http://localhost:52333/callback",
      undefined,
    );
    expect(d.exchange).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "cid",
        clientSecret: "csec",
        code: "authcode",
        codeVerifier: "verifier",
        redirectUri: "http://localhost:52333/callback",
      }),
      undefined,
    );
    const saved = store.current()!;
    expect(saved.refreshToken).toBe("rt");
    expect(saved.clientId).toBe("cid");
    expect(saved.accessToken).toBe("at");
  });

  it("reuses stored client credentials instead of registering again", async () => {
    const store = memStore({ clientId: "existing", clientSecret: "esec", refreshToken: "old" });
    const d = deps();
    await loginConnection({ label: "acme", baseUrl: "https://x", store, port: 52333 }, d as never);
    expect(d.register).not.toHaveBeenCalled();
    expect(d.exchange).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "existing", clientSecret: "esec" }),
      undefined,
    );
  });

  it("closes the loopback server even if the exchange fails", async () => {
    const close = vi.fn();
    const d = deps({
      startLoopback: vi.fn().mockResolvedValue({
        redirectUri: "http://localhost:52333/callback",
        waitForCode: vi.fn().mockResolvedValue("authcode"),
        close,
      }),
      exchange: vi.fn().mockRejectedValue(new Error("boom")),
    });
    await expect(
      loginConnection({ label: "acme", baseUrl: "https://x", store: memStore(), port: 52333 }, d as never),
    ).rejects.toThrow("boom");
    expect(close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter twenty-core test src/auth/loginFlow.test.ts`
Expected: FAIL — cannot resolve `./loginFlow.js`.

- [ ] **Step 3: Implement**

Create `packages/twenty-core/src/auth/loginFlow.ts`:

```ts
import { randomBytes } from "node:crypto";
import type { TokenStore } from "./tokenStore.js";
import { generateCodeVerifier, codeChallengeS256 } from "./pkce.js";
import { registerClient, exchangeCode, buildAuthorizeUrl } from "./oauthClient.js";
import { startLoopback, openBrowser } from "./loopback.js";

export interface LoginDeps {
  register: typeof registerClient;
  exchange: typeof exchangeCode;
  startLoopback: typeof startLoopback;
  openBrowser: typeof openBrowser;
  generateVerifier: () => string;
  challenge: (verifier: string) => string;
  makeState: () => string;
  log: (msg: string) => void;
}

const DEFAULT_PORT = 52333;

function defaultDeps(): LoginDeps {
  return {
    register: registerClient,
    exchange: exchangeCode,
    startLoopback,
    openBrowser,
    generateVerifier: generateCodeVerifier,
    challenge: codeChallengeS256,
    makeState: () => randomBytes(16).toString("base64url"),
    // CLI-only orchestration: stdout is fine here (not the MCP server).
    log: (msg) => console.log(msg),
  };
}

export async function loginConnection(
  args: { label: string; baseUrl: string; store: TokenStore; port?: number },
  deps: LoginDeps = defaultDeps(),
): Promise<void> {
  const port = args.port ?? DEFAULT_PORT;
  const existing = await args.store.get(args.label);
  const server = await deps.startLoopback(port);
  try {
    let clientId = existing?.clientId;
    let clientSecret = existing?.clientSecret;
    if (!clientId || !clientSecret) {
      const creds = await deps.register(args.baseUrl, server.redirectUri, undefined);
      clientId = creds.clientId;
      clientSecret = creds.clientSecret;
    }

    const verifier = deps.generateVerifier();
    const challenge = deps.challenge(verifier);
    const state = deps.makeState();
    const authorizeUrl = buildAuthorizeUrl({
      baseUrl: args.baseUrl,
      clientId,
      redirectUri: server.redirectUri,
      state,
      codeChallenge: challenge,
    });

    deps.log(`Opening your browser to sign in. If it does not open, visit:\n${authorizeUrl}`);
    deps.openBrowser(authorizeUrl);

    const code = await server.waitForCode(state);
    const tokens = await deps.exchange(
      {
        baseUrl: args.baseUrl,
        clientId,
        clientSecret,
        code,
        redirectUri: server.redirectUri,
        codeVerifier: verifier,
      },
      undefined,
    );

    await args.store.set(args.label, {
      clientId,
      clientSecret,
      refreshToken: tokens.refreshToken ?? "",
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
    });
    deps.log(`Signed in to "${args.label}".`);
  } finally {
    server.close();
  }
}
```

- [ ] **Step 4: Export from the barrel**

Add to `packages/twenty-core/src/index.ts`:

```ts
export { loginConnection } from "./auth/loginFlow.js";
export type { LoginDeps } from "./auth/loginFlow.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter twenty-core test src/auth/loginFlow.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): OAuth login flow orchestration (register + PKCE + loopback + exchange)"
```

---

### Task 7: Registry-file loader + wire OAuth connections

**Files:**
- Modify: `packages/twenty-core/src/auth/registry.ts`
- Modify: `packages/twenty-core/src/auth/registry.test.ts`
- Modify: `packages/twenty-core/src/index.ts` (exports)

**Interfaces:**
- Consumes: `OAuthProvider` (Task 4), `FileTokenStore`/`defaultConfigDir` (Task 2), `node:fs`.
- Produces:
  - `loadRegistryFile(path: string): RegistryFile | null` — reads + JSON-parses a connections file, returns `null` if it does not exist.
  - `buildConnectionFromConfig` extended: `auth: "oauth"` now returns a `Connection` whose `getBearer` delegates to an `OAuthProvider` (backed by a `FileTokenStore` at `defaultConfigDir()`), instead of throwing.
  - `resolveActiveConnection(env, opts?)` extended: `opts` gains `{ store?: TokenStore; configPath?: string }`. Resolution order unchanged, but when no in-memory `registry` is passed it now loads the registry file from `env.TWENTY_MCP_CONFIG` or `${defaultConfigDir(env)}/connections.json` before falling back to the legacy env path.

- [ ] **Step 1: Write the failing tests (extend the existing file)**

Add these cases to `packages/twenty-core/src/auth/registry.test.ts` (keep the existing ones):

```ts
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRegistryFile } from "./registry.js";
import type { TokenStore, TokenRecord } from "./tokenStore.js";

function memStore(rec: TokenRecord | null): TokenStore {
  return {
    get: async () => rec,
    set: async () => {},
    delete: async () => {},
    labels: async () => (rec ? ["acme-oauth"] : []),
  };
}

describe("loadRegistryFile", () => {
  it("returns null when the file is absent", () => {
    expect(loadRegistryFile(join(tmpdir(), "nope-does-not-exist.json"))).toBeNull();
  });

  it("parses a registry file", () => {
    const dir = mkdtempSync(join(tmpdir(), "twenty-reg-"));
    const path = join(dir, "connections.json");
    writeFileSync(
      path,
      JSON.stringify({
        defaultConnection: "acme-oauth",
        connections: { "acme-oauth": { baseUrl: "https://crm.acme.com", auth: "oauth" } },
      }),
    );
    const reg = loadRegistryFile(path);
    expect(reg?.defaultConnection).toBe("acme-oauth");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("oauth connections", () => {
  const registry = {
    connections: { "acme-oauth": { baseUrl: "https://crm.acme.com/", auth: "oauth" as const } },
    defaultConnection: "acme-oauth",
  };

  it("builds an oauth Connection whose getBearer refreshes via the stored record", async () => {
    const conn = resolveActiveConnection(
      { TWENTY_CONNECTION: "acme-oauth" },
      {
        registry,
        store: memStore({
          clientId: "cid",
          clientSecret: "csec",
          refreshToken: "rt",
          accessToken: "live",
          expiresAt: Number.MAX_SAFE_INTEGER,
        }),
      },
    );
    expect(conn.label).toBe("acme-oauth");
    expect(conn.baseUrl).toBe("https://crm.acme.com");
    expect(await conn.getBearer()).toBe("live");
  });

  it("an oauth connection with no stored login yields an actionable getBearer error", async () => {
    const conn = resolveActiveConnection(
      { TWENTY_CONNECTION: "acme-oauth" },
      { registry, store: memStore(null) },
    );
    await expect(conn.getBearer()).rejects.toThrow(/twenty-mcp login acme-oauth/);
  });
});
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `pnpm --filter twenty-core test src/auth/registry.test.ts`
Expected: FAIL — `loadRegistryFile` is not exported; `resolveActiveConnection` does not accept a `store` option; oauth still throws "Plan 2".

- [ ] **Step 3: Implement the registry changes**

Edit `packages/twenty-core/src/auth/registry.ts`.

Add imports at the top (after the existing imports):

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OAuthProvider } from "./oauthProvider.js";
import { FileTokenStore, defaultConfigDir, type TokenStore } from "./tokenStore.js";
```

Add the file loader (near the other exports):

```ts
export function loadRegistryFile(path: string): RegistryFile | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as RegistryFile;
}
```

Change `buildConnectionFromConfig` to accept an optional store and handle oauth. Replace the whole function with:

```ts
export function buildConnectionFromConfig(
  label: string,
  cfg: ConnectionConfig,
  env: NodeJS.ProcessEnv,
  store?: TokenStore,
): Connection {
  if (cfg.auth === "oauth") {
    const tokenStore = store ?? new FileTokenStore(defaultConfigDir(env));
    const provider = new OAuthProvider({
      label,
      baseUrl: stripTrailingSlash(cfg.baseUrl),
      store: tokenStore,
    });
    return {
      label,
      baseUrl: stripTrailingSlash(cfg.baseUrl),
      env: cfg.env,
      getBearer: () => provider.getBearer(),
    };
  }
  const perLabel = envKeyForLabel(label);
  const apiKey = env[perLabel]?.trim() || env.TWENTY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      `No API key for connection "${label}". Set ${perLabel} (or TWENTY_API_KEY) in the environment.`,
    );
  }
  const apiProvider = new ApiKeyProvider(apiKey);
  return {
    label,
    baseUrl: stripTrailingSlash(cfg.baseUrl),
    env: cfg.env,
    getBearer: () => apiProvider.getBearer(),
  };
}
```

Change `resolveActiveConnection` to accept the store + config-file loading. Replace the whole function with:

```ts
export function resolveActiveConnection(
  env: NodeJS.ProcessEnv,
  opts?: { registry?: RegistryFile; store?: TokenStore; configPath?: string },
): Connection {
  const registry =
    opts?.registry ??
    loadRegistryFile(
      opts?.configPath ??
        env.TWENTY_MCP_CONFIG?.trim() ??
        join(defaultConfigDir(env), "connections.json"),
    );

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
    return buildConnectionFromConfig(label, cfg, env, opts?.store);
  }

  const legacy = legacyConnectionFromEnv(env);
  if (legacy) return legacy;

  throw new Error(
    "No Twenty connection configured. Set TWENTY_BASE_URL and TWENTY_API_KEY, " +
      "or provide a connection registry.",
  );
}
```

(The prior `auth === "oauth"` throw is removed by the replacement above.)

- [ ] **Step 4: Export the loader**

Add to `packages/twenty-core/src/index.ts`:

```ts
export { loadRegistryFile } from "./auth/registry.js";
```

- [ ] **Step 5: Run the registry test, then the full core suite**

Run: `pnpm --filter twenty-core test src/auth/registry.test.ts`
Expected: PASS (existing + new cases; the previous "throws 'Plan 2' for oauth connections" case must be removed/updated — delete that specific assertion from the file, since oauth now resolves).

Run: `pnpm --filter twenty-core test`
Expected: PASS — whole core package green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): registry-file loader + resolve OAuth connections via token store"
```

---

### Task 8: `twenty-mcp` setup CLI (login / connections / logout)

**Files:**
- Create: `packages/twenty-crm-mcp/src/cli.ts` (pure, testable: `runCli` + `realDeps`)
- Create: `packages/twenty-crm-mcp/src/cli-bin.ts` (the executable entry — no self-execution guard needed)
- Test: `packages/twenty-crm-mcp/src/cli.test.ts`
- Modify: `packages/twenty-crm-mcp/package.json` (second `bin` + tsup entry via config)
- Modify: `packages/twenty-crm-mcp/tsup.config.ts` (add the `cli-bin.ts` entry)

**Interfaces:**
- Consumes: `loginConnection`, `loadRegistryFile`, `FileTokenStore`, `defaultConfigDir` (from `twenty-core`).
- Produces: `runCli(argv: string[], deps): Promise<number>` returning a process exit code, and `realDeps(env): CliDeps`. A separate `cli-bin.ts` (its own tsup entry / the `twenty-mcp` bin) imports and calls them — keeping `cli.ts` free of top-level side effects so tests can import it safely, and avoiding a fragile `import.meta.url` self-exec guard. Subcommands: `login <label>`, `connections`, `logout <label>`. `deps` injects `{ store, loadRegistry, login, out, err }` for testing.

- [ ] **Step 1: Write the failing test**

Create `packages/twenty-crm-mcp/src/cli.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runCli } from "./cli.js";

function deps(over: Record<string, unknown> = {}) {
  return {
    store: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      labels: vi.fn().mockResolvedValue(["acme-oauth"]),
    },
    loadRegistry: vi.fn().mockReturnValue({
      defaultConnection: "acme-oauth",
      connections: { "acme-oauth": { baseUrl: "https://crm.acme.com", auth: "oauth" } },
    }),
    login: vi.fn().mockResolvedValue(undefined),
    out: vi.fn(),
    err: vi.fn(),
    ...over,
  };
}

describe("runCli", () => {
  it("login <label> resolves the baseUrl from the registry and runs the flow", async () => {
    const d = deps();
    const code = await runCli(["login", "acme-oauth"], d as never);
    expect(code).toBe(0);
    expect(d.login).toHaveBeenCalledWith(
      expect.objectContaining({ label: "acme-oauth", baseUrl: "https://crm.acme.com" }),
    );
  });

  it("login errors when the label is unknown in the registry", async () => {
    const d = deps();
    const code = await runCli(["login", "nope"], d as never);
    expect(code).toBe(1);
    expect(d.err).toHaveBeenCalledWith(expect.stringMatching(/nope/));
    expect(d.login).not.toHaveBeenCalled();
  });

  it("connections lists registry labels and their signed-in state", async () => {
    const d = deps();
    const code = await runCli(["connections"], d as never);
    expect(code).toBe(0);
    expect(d.out).toHaveBeenCalledWith(expect.stringMatching(/acme-oauth/));
  });

  it("logout <label> deletes the stored record", async () => {
    const d = deps();
    const code = await runCli(["logout", "acme-oauth"], d as never);
    expect(code).toBe(0);
    expect(d.store.delete).toHaveBeenCalledWith("acme-oauth");
  });

  it("returns a usage error for an unknown command", async () => {
    const d = deps();
    const code = await runCli(["frobnicate"], d as never);
    expect(code).toBe(1);
    expect(d.err).toHaveBeenCalledWith(expect.stringMatching(/usage/i));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter twenty-crm-mcp test src/cli.test.ts`
Expected: FAIL — cannot resolve `./cli.js`.

- [ ] **Step 3: Implement the CLI**

Create `packages/twenty-crm-mcp/src/cli.ts`:

```ts
import {
  loginConnection,
  loadRegistryFile,
  FileTokenStore,
  defaultConfigDir,
  type TokenStore,
  type RegistryFile,
} from "twenty-core";
import { join } from "node:path";

export interface CliDeps {
  store: TokenStore;
  loadRegistry: () => RegistryFile | null;
  login: typeof loginConnection;
  out: (msg: string) => void;
  err: (msg: string) => void;
}

export function realDeps(env: NodeJS.ProcessEnv): CliDeps {
  const dir = defaultConfigDir(env);
  return {
    store: new FileTokenStore(dir),
    loadRegistry: () =>
      loadRegistryFile(env.TWENTY_MCP_CONFIG?.trim() ?? join(dir, "connections.json")),
    login: loginConnection,
    out: (m) => console.log(m),
    err: (m) => console.error(m),
  };
}

const USAGE =
  "usage: twenty-mcp <login <label> | connections | logout <label>>";

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [cmd, label] = argv;

  if (cmd === "login") {
    if (!label) {
      deps.err(USAGE);
      return 1;
    }
    const registry = deps.loadRegistry();
    const cfg = registry?.connections[label];
    if (!cfg) {
      deps.err(`Unknown connection "${label}". Add it to your connections registry first.`);
      return 1;
    }
    await deps.login({ label, baseUrl: cfg.baseUrl, store: deps.store });
    return 0;
  }

  if (cmd === "connections") {
    const registry = deps.loadRegistry();
    const labels = Object.keys(registry?.connections ?? {});
    if (labels.length === 0) {
      deps.out("No connections configured.");
      return 0;
    }
    const signedIn = new Set(await deps.store.labels());
    for (const l of labels) {
      const cfg = registry!.connections[l];
      const state = cfg.auth === "oauth" ? (signedIn.has(l) ? "signed in" : "not signed in") : "api key";
      deps.out(`${l}  (${cfg.auth}, ${cfg.baseUrl})  — ${state}`);
    }
    return 0;
  }

  if (cmd === "logout") {
    if (!label) {
      deps.err(USAGE);
      return 1;
    }
    await deps.store.delete(label);
    deps.out(`Logged out of "${label}".`);
    return 0;
  }

  deps.err(USAGE);
  return 1;
}
```

- [ ] **Step 4: Create the executable entry**

Create `packages/twenty-crm-mcp/src/cli-bin.ts` (tsup prepends the shebang banner; this file has no top-level guard, so tests never import it):

```ts
import { runCli, realDeps } from "./cli.js";

runCli(process.argv.slice(2), realDeps(process.env))
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
```

- [ ] **Step 5: Add the CLI as a second bin + tsup entry**

In `packages/twenty-crm-mcp/package.json`, change `bin` to include the CLI:

```json
  "bin": {
    "twenty-crm-mcp": "dist/index.js",
    "twenty-mcp": "dist/cli-bin.js"
  },
```

In `packages/twenty-crm-mcp/tsup.config.ts`, add `cli-bin.ts` to `entry`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli-bin.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  noExternal: ["twenty-core"],
});
```

- [ ] **Step 6: Run the CLI test, then build**

Run: `pnpm --filter twenty-crm-mcp test src/cli.test.ts`
Expected: PASS (all cases).

Run: `pnpm --filter twenty-crm-mcp build`
Expected: produces `dist/index.js` and `dist/cli-bin.js`, each with the `#!/usr/bin/env node` shebang.

- [ ] **Step 7: Run the full suite**

Run: `pnpm -r test`
Expected: PASS — both packages green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(cli): twenty-mcp setup CLI (login/connections/logout)"
```

---

### Task 9: Live verification + docs

**Files:**
- Create: `docs/oauth-verification.md` (a manual checklist)
- Modify: `packages/twenty-crm-mcp/README.md` (document OAuth setup + the connection registry)
- Modify: `packages/twenty-crm-mcp/skill/twenty-crm/SKILL.md` (note the OAuth/apikey auth modes and the CLI)

**Interfaces:**
- Consumes: everything above. No new code interface.

This task confirms the one unverified wire fact (confidential-vs-public client on the live 2.17.2 instance) and documents setup. It is partly manual because the browser step cannot be automated.

- [ ] **Step 1: Write the manual verification checklist**

Create `docs/oauth-verification.md` capturing the exact commands to run against the live instance:

```markdown
# OAuth Live Verification (Twenty 2.17.2)

Prereq: a self-hosted Twenty URL and a browser session for a real user.

1. Create `~/.config/twenty-mcp/connections.json`:
   {
     "defaultConnection": "live",
     "connections": { "live": { "baseUrl": "https://<your-twenty>", "auth": "oauth" } }
   }
2. Run: `node packages/twenty-crm-mcp/dist/cli.js login live`
   - Confirm a browser opens to `/oauth/authorize` and, after approving, the tab shows "Sign-in complete."
   - Confirm `~/.config/twenty-mcp/tokens.json` now contains a `live` entry (ciphertext only) and `store.key` is mode 0600.
3. Confirm `/oauth/register` accepted the loopback redirect (no error in the CLI). If Twenty rejected the loopback URI or required a public client, record the exact error here and adjust `registerClient` (Task 3) accordingly.
4. Start the server against the connection and confirm a real read works:
   `TWENTY_CONNECTION=live node packages/twenty-crm-mcp/dist/index.js` (drive via an MCP client; run `list_object_types`).
5. Force a refresh: set the stored `expiresAt` to the past (or wait for expiry) and confirm the next call refreshes without re-login.

Record PASS/FAIL and any wire-format corrections needed.
```

- [ ] **Step 2: Run the automated suite as the pre-live gate**

Run: `pnpm -r test`
Expected: PASS — all unit tests green (these cover every non-interactive path with fakes).

- [ ] **Step 3: Document OAuth setup in the package README**

Add an "Authentication" section to `packages/twenty-crm-mcp/README.md` describing: the two modes (API key via `TWENTY_BASE_URL`/`TWENTY_API_KEY`; OAuth via a connection registry + `twenty-mcp login`), the `connections.json` shape, and that OAuth acts as the signed-in user inheriting their Twenty role. Keep secrets out of examples.

- [ ] **Step 4: Note the auth modes in the Skill**

Add a short note to `packages/twenty-crm-mcp/skill/twenty-crm/SKILL.md` that the server supports API-key and OAuth connections, selected by `TWENTY_CONNECTION`, and that OAuth sign-in is a one-time `twenty-mcp login <label>` step.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: OAuth setup, connection registry, and live-verification checklist"
```

---

## Self-Review

**Spec coverage (against the foundation design's auth section):**
- OAuth Authorization-Code + PKCE, acting as the signed-in user — Tasks 1, 3, 4, 6. ✅
- Dynamic client registration (loopback redirect) — Tasks 3, 5, 6. ✅
- Encrypted token store (AES-256-GCM file, 0600 key, no native deps) — Task 2. ✅
- API-key provider kept as the fallback — untouched from Plan 1; the apikey branch in `buildConnectionFromConfig` is preserved (Task 7). ✅
- Named connections via a registry file; active selection by `TWENTY_CONNECTION`/default — Task 7. ✅
- Setup CLI (`login`/`connections`/`logout`) — Task 8. ✅
- Same `getBearer()` seam → no client/server changes — verified by the absence of any edit to `restClient.ts`/`graphqlClient.ts`/`server.ts` in this plan. ✅
- Live verification of the confidential-vs-public client question — Task 9. ✅
- **Deferred (noted, not built):** in-session `switch_connection` runtime swap; profiles/recipes (Plan 3); publish-prep doc fixes.

**Placeholder scan:** No TBD/TODO. Every code step has full contents; the two doc tasks (9.3, 9.4) describe exact sections to add rather than pasting prose, which is appropriate for documentation.

**Type consistency:** `TokenRecord`/`TokenStore` (Task 2) are consumed unchanged by `OAuthProvider` (Task 4), `loginConnection` (Task 6), the registry (Task 7), and the CLI (Task 8). `TokenResponse { accessToken; refreshToken?; expiresIn? }` (Task 3) is the return type used by `OAuthProvider` and `loginConnection`. `registerClient(baseUrl, redirectUri, fetchImpl?)`, `exchangeCode(args, fetchImpl?)`, `refreshToken(args, fetchImpl?)` signatures match between their definition (Task 3) and every caller (Tasks 4, 6). `resolveActiveConnection(env, { registry?, store?, configPath? })` matches between Task 7's definition and the registry tests.

**Known-cost note for the implementer:** Task 7 edits the existing `registry.test.ts` — it must DELETE the Plan-1 "throws 'Plan 2' for oauth connections" assertion (oauth now resolves) while keeping every other Plan-1 registry test green. Do not delete the apikey cases.
