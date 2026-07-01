# Auth model

Authentication is built around a single seam: everything above it consumes a `Connection` that yields a valid bearer token on demand (`getBearer()`). The transport clients do not know or care how that token was obtained, so credential strategies plug in without touching the rest of the system.

## Pluggable credential providers

- **API key** — a static bearer, the simplest setup.
- **OAuth** — acts as the signed-in user. It performs [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414) endpoint discovery and [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591) dynamic client registration, then runs the authorization-code + PKCE flow via a loopback redirect. It adapts to whatever your instance issues — a public (PKCE-only) or confidential client. Access tokens are refreshed automatically.

Both are configured per named connection in a registry, so several instances can coexist and one is selected per server run. See [Connections](/guide/connections).

## Access level follows identity

With an OAuth connection, the token *is* the user: object, field, and row permissions are whatever Twenty grants that user, enforced by Twenty. The suite's capability profile curates the tool surface on top; the user's role is the real boundary underneath.

## Secrets at rest

Refresh tokens and API keys are stored encrypted with AES-256-GCM under `~/.config/twenty-mcp/`, with the master key file at mode `0600`. Nothing sensitive is written in plaintext, and corrupt or tampered stores fail closed with a clear error.
