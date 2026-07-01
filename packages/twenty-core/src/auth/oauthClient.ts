import { TwentyApiError } from "../twenty/errors.js";

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

/** Fallback access-token lifetime (seconds) when a token response omits expires_in. */
export const DEFAULT_TOKEN_TTL_SECONDS = 300;

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
  const b = (parsed && typeof parsed === "object" ? parsed : {}) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
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
  const b = (parsed && typeof parsed === "object" ? parsed : {}) as {
    client_id?: string;
    client_secret?: string;
  };
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
