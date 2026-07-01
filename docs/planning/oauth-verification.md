# OAuth Live Verification (Twenty 2.17.2)

> **STATUS: PASSED** — verified 2026-07-01 against `crm.five59.com` (Twenty 2.17.2).
> Findings: the instance issues **public (PKCE-only) clients** (no `client_secret`), and its
> `authorization_endpoint` is `/authorize` (not `/oauth/authorize`). Both were handled by
> reworking the client to be **discovery-driven** (RFC 8414) with optional `client_secret`.
> Login opened the browser, completed the round-trip, stored an encrypted token, and a
> `list_object_types` smoke returned the full live object list (incl. a custom object) — the
> token authorizes REST as the signed-in user, scoped to their role. The `127.0.0.1` loopback
> redirect did not hang. Refresh-token behavior post-expiry was not exercised (the refresh path
> is unit-tested). The steps below are retained as the reproducible checklist.

Plan 2's OAuth sign-in is code-complete and fully unit-tested, but two wire-level questions
could only be answered against a live self-hosted Twenty instance. Both were designed to
**fail loudly** rather than behave insecurely, so this check was about confirming the happy
path and catching the two known unknowns — not about safety.

**Prereq:** a self-hosted Twenty URL and a browser session logged in as a real user.

## 0. Build the binaries

```
pnpm install
pnpm --filter twenty-crm-mcp build
```

This produces `packages/twenty-crm-mcp/dist/cli-bin.js` (the `twenty-mcp` CLI) and `dist/index.js`
(the server).

## 1. Create a connection registry

`~/.config/twenty-mcp/connections.json`:

```json
{
  "defaultConnection": "live",
  "connections": {
    "live": { "baseUrl": "https://<your-twenty-domain>", "auth": "oauth" }
  }
}
```

## 2. Run the sign-in flow

```
node packages/twenty-crm-mcp/dist/cli-bin.js login live
```

Expected: your browser opens to `/oauth/authorize`; after you approve, the tab shows
"Sign-in complete. You can close this tab.", and the CLI prints `Signed in to "live".`

Then confirm at-rest state:
- `~/.config/twenty-mcp/tokens.json` has a `live` entry containing only ciphertext (`iv`/`tag`/`ct`) — no readable token.
- `~/.config/twenty-mcp/store.key` is mode `0600`.

## PRIORITY CHECK A — loopback host resolution

The listener binds `127.0.0.1`; the redirect URI is `http://localhost:<port>/callback`. If the
browser's callback **hangs** (never reaches "Sign-in complete"), your system is likely resolving
`localhost` to IPv6 `::1` while the listener is IPv4-only.

**Fix if it hangs:** in `packages/twenty-core/src/auth/loopback.ts`, either set the `redirectUri`
to `http://127.0.0.1:<port>/callback`, or make the server listen on `localhost` / both address
families. Re-register the client after changing the redirect URI (delete the `live` entry and
re-run `login`, since the redirect URI is baked into registration).

## PRIORITY CHECK B — confidential vs public client

The code assumes a **confidential** client (Twenty's dynamic registration returns a `client_secret`,
sent on exchange/refresh with `token_endpoint_auth_method: client_secret_post`).

If `login` fails at registration with **"Twenty OAuth registration response missing client
credentials"**, then 2.17.2 issues **public** clients (no secret). That's a clean, non-silent
failure — not a security downgrade. Fix: add a public-client variant in
`packages/twenty-core/src/auth/oauthClient.ts` (omit `client_secret`, rely on PKCE) and thread a
`confidential` flag through the login flow.

## 3. Confirm a real API call works as the signed-in user

```
TWENTY_CONNECTION=live node packages/twenty-crm-mcp/dist/index.js
```

Drive it from an MCP client and call `list_object_types` (or `query_records`). You should see only
what your Twenty **role** permits — that is the point of acting as the signed-in user.

## 4. Confirm refresh works

Edit the stored record's `expiresAt` to a past timestamp (or wait for the token to expire), then
make another call. It should transparently refresh (no re-login) and update `tokens.json`.

## Record the outcome

Note PASS/FAIL for steps 2–4 and the two priority checks, plus any wire-format correction you had
to make. Once confirmed, the remaining Task 9 docs (README "Authentication" section + a Skill note)
can be finalized to match the verified behavior.
