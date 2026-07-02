# Design: token-store file locking + encrypted API-key storage

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan
**Issues:** #9 (FileTokenStore file locking), #16 (store API keys in the encrypted token store)

## Problem

Two related gaps in the credential layer:

1. **Lost updates in `FileTokenStore` (#9).** `set()` and `delete()` do an unlocked
   read-modify-write of `tokens.json`. A concurrent `twenty-mcp login` and a server-side
   OAuth refresh can interleave and silently **drop a connection label** from the store.
   Writes are also non-atomic (`writeFileSync` in place), so a crash mid-write can
   corrupt the file.
2. **API keys are env-only (#16).** `buildConnectionFromConfig` resolves API keys from
   `TWENTY_API_KEY_<LABEL>` / `TWENTY_API_KEY` and throws otherwise. Users who don't want
   long-lived secrets in MCP client configs or shell profiles have no alternative, even
   though an encrypted store (AES-256-GCM, key file mode 0600) already exists for OAuth
   tokens.

They interlock: #16 adds more writers to the store, making #9 a prerequisite.

## Part 1 — locking + atomic writes (#9)

All changes are internal to `packages/twenty-core/src/auth/tokenStore.ts`. The public
`TokenStore` interface is unchanged.

### Atomic writes

`writeAll` writes to a sibling temp file `tokens.json.tmp-<pid>-<random>` (mode 0600),
then `renameSync`s it over `tokens.json`. Same-directory rename is atomic on
macOS/Linux and same-volume Windows, so readers can never observe a torn file.

### Advisory lockfile

A private async `withLock(fn)` helper serializes mutators:

- **Acquire:** create `tokens.json.lock` with the `wx` flag (exclusive create — atomic
  on all platforms). Write the PID into it for diagnostics.
- **On `EEXIST`:** if the lock file's mtime is older than the stale threshold
  (default 10 s — the holder crashed), unlink it and retry immediately. Otherwise sleep
  (default 25 ms) and retry until the acquire timeout (default 5 s), then throw an error
  naming the lock path and suggesting deleting it if no other `twenty-mcp` process is
  running.
- **Release:** unlink in a `finally`.
- Stale threshold, timeout, and sleep function are injectable via a new optional
  `FileTokenStore` constructor options argument so tests never wait in real time.

### Lock scope

Only the mutating read-modify-write operations — `set()` and `delete()` — take the lock;
that read-map/mutate/write-map window is exactly where lost updates drop labels.
`get()` and `labels()` stay lock-free: atomic renames guarantee complete reads, and a
slightly stale read is harmless.

### Out of scope (deliberate)

- **Application-level refresh coordination.** Two concurrent OAuth refreshes both
  hitting the token endpoint is not a store-corruption problem; the OAuth server
  arbitrates. Last-writer-wins on the same label is acceptable.
- **`saveRegistryFile` locking.** The registry has a single interactive writer (setup).

## Part 2 — API keys in the encrypted store (#16)

### Stored record shape

`TokenRecord` becomes a discriminated union in `tokenStore.ts`:

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
```

`TokenStore.get/set` are typed over `StoredCredential`. The existing `TokenRecord`
export remains as a deprecated alias of `OAuthTokenRecord` so `oauthProvider.ts`,
`loginFlow.ts`, and any external consumers keep compiling; internal call sites migrate
to the new names. **Backwards compatibility:** a
decrypted record with no `kind` field is normalized to `kind: "oauth"` on read. Existing
stores keep working with no migration step. Encryption per label is unchanged
(AES-256-GCM, same key file).

### Resolution precedence (registry.ts)

The `apikey` branch of `buildConnectionFromConfig` changes from eager-throw to a lazy
provider, symmetric with OAuth. Precedence:

1. `TWENTY_API_KEY_<LABEL>` (env, per connection)
2. `TWENTY_API_KEY` (env, global fallback)
3. Encrypted store: an `ApiKeyRecord` under the connection's label

If an env key exists at build time, short-circuit to the existing `ApiKeyProvider`
(current fast path, unchanged behavior). Otherwise return a provider whose `getBearer()`
reads the store; if no `ApiKeyRecord` is found (or the record is `kind: "oauth"`), it
throws: `No API key for connection "<label>". Set TWENTY_API_KEY_<LABEL>, or run:
twenty-mcp login <label>`.

**Behavioral change:** with no env key, the server now starts and fails on the first
tool call instead of failing at launch — consistent with the OAuth path ("Not signed
in…") and the "server starts even if Twenty is down" principle.

The registry file (`connections.json`) still **never stores secrets** and gains no new
fields.

### CLI: `login` / `logout`

`twenty-mcp login <label>` branches on the connection's `auth`:

- `oauth` → existing browser flow, unchanged.
- `apikey` → masked interactive prompt for the key; writes
  `{kind: "apikey", apiKey}` to the store for that label.

`logout <label>` already deletes the label's record — it now covers both kinds with no
change. No new commands. No `--api-key` flag: secrets on argv leak into process lists
and shell history, so key entry is interactive-only.

### Setup TUI

When the user picks "API key" in the add/edit flows, one follow-up select:

- **Store it encrypted now** → masked prompt, write `ApiKeyRecord` via the injected
  store. Requires a new `password` method on the `PromptAPI` abstraction
  (`packages/twenty-crm-mcp/src/prompts.ts`) backed by `@clack/prompts`' `password`,
  plus support in the scripted fake used by tests.
- **Read from environment** → current behavior: print the exact env var name to set.

Cancel-safe like every other setup prompt. The non-interactive setup path (`--auth
apikey` flags) is unchanged and cannot store keys — by design (no secrets on argv).

### Docs

- Update AGENTS.md / README auth sections: API keys are env-first with an optional
  encrypted-store fallback (they currently say env-only).
- Update the docs-site setup/connections pages accordingly.
- Close the loop on issue #16's source note in
  `docs/superpowers/specs/2026-07-01-setup-command-design.md` (that spec's credential
  policy is superseded on this one point).

## Testing

All tests use temp dirs and injected fakes; no network, no real waiting.

**Part 1 (tokenStore):**
- Interleaved `set()`s of different labels never drop a label.
- A held lock makes a second writer wait, then succeed (injected sleep/now).
- A stale lock (old mtime) is broken and the write proceeds.
- Acquire timeout throws the helpful error naming the lock path.
- `writeAll` leaves no temp files behind and never exposes a partial `tokens.json`.

**Part 2:**
- `StoredCredential` round-trip for both kinds; legacy record without `kind` reads as
  oauth.
- Provider precedence: per-label env > global env > store > error message with both
  remedies.
- `login` on an apikey connection stores the prompted key (scripted fake prompts);
  `logout` removes it.
- Setup add/edit flows with scripted `password` responses, including cancel paths.

## Sequencing

Part 1 lands first (locking makes concurrent store writers safe), then Part 2 builds on
the union record shape. One implementation plan, two phases.
