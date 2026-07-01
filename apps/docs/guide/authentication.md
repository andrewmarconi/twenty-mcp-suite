# Authentication

The server authenticates to Twenty in one of two ways. Both resolve to a bearer token used identically against Twenty's API.

## API key (simplest)

Provide `TWENTY_BASE_URL` + `TWENTY_API_KEY` (created in Twenty under Settings > APIs & Webhooks). The assistant acts with that key's permissions. This is the quickest setup — see [Installation](/guide/installation).

## OAuth sign-in (act as yourself)

Sign in through your browser so the assistant acts as **you**, inheriting your Twenty role — object, field, and row permissions enforced by Twenty — with no long-lived key to manage.

It uses Twenty's OAuth 2.0 authorization-code flow with PKCE, **dynamic client registration** ([RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)), and **endpoint discovery** ([RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414)), so it adapts to your instance automatically — public or confidential client, whatever endpoints your version exposes.

### Sign in

1. Create a [connection registry](/guide/connections) at `~/.config/twenty-mcp/connections.json`.

2. Sign in once with the bundled `twenty-mcp` CLI (opens your browser):

   ```bash
   twenty-mcp login acme
   ```

   The refresh token is stored **encrypted** (AES-256-GCM) under `~/.config/twenty-mcp/`, with the key file at mode `0600`. Nothing sensitive is written in plaintext. Access tokens refresh automatically; you sign in again only if the refresh token is revoked or expires.

3. Run the server against that connection:

   ```json
   {
     "mcpServers": {
       "twenty-crm": {
         "command": "npx",
         "args": ["-y", "twenty-crm-mcp"],
         "env": { "TWENTY_CONNECTION": "acme" }
       }
     }
   }
   ```
