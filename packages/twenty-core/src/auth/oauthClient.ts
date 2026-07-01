import { TwentyApiError } from "../twenty/errors.js";

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export interface OAuthServerMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  tokenEndpointAuthMethods: string[];
}

/** Fallback access-token lifetime (seconds) when a token response omits expires_in. */
export const DEFAULT_TOKEN_TTL_SECONDS = 300;

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function asObject(parsed: unknown): Record<string, unknown> {
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

/** RFC 8414 discovery — the source of truth for this instance's OAuth endpoints. */
export async function discoverOAuth(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthServerMetadata> {
  const url = `${stripSlash(baseUrl)}/.well-known/oauth-authorization-server`;
  const res = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" } });
  const text = await res.text();
  const parsed = text ? safeJson(text) : {};
  if (!res.ok) {
    throw new TwentyApiError(`Twenty OAuth discovery failed (${res.status})`, res.status, parsed, url);
  }
  const b = asObject(parsed);
  const authorizationEndpoint = b.authorization_endpoint as string | undefined;
  const tokenEndpoint = b.token_endpoint as string | undefined;
  const registrationEndpoint = b.registration_endpoint as string | undefined;
  if (!authorizationEndpoint || !tokenEndpoint || !registrationEndpoint) {
    throw new TwentyApiError(
      "Twenty OAuth discovery document is missing required endpoints",
      res.status,
      parsed,
      url,
    );
  }
  return {
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
    tokenEndpointAuthMethods: Array.isArray(b.token_endpoint_auth_methods_supported)
      ? (b.token_endpoint_auth_methods_supported as string[])
      : [],
  };
}

export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  authMethod: "none" | "client_secret_post",
  fetchImpl: typeof fetch = fetch,
): Promise<{ clientId: string; clientSecret?: string }> {
  const res = await fetchImpl(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "twenty-crm-mcp",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: authMethod,
    }),
  });
  const text = await res.text();
  const parsed = text ? safeJson(text) : {};
  if (!res.ok) {
    throw new TwentyApiError(
      `Twenty OAuth client registration failed (${res.status})`,
      res.status,
      parsed,
      registrationEndpoint,
    );
  }
  const b = asObject(parsed);
  const clientId = b.client_id as string | undefined;
  if (!clientId) {
    throw new TwentyApiError(
      "Twenty OAuth registration response missing client_id",
      res.status,
      parsed,
      registrationEndpoint,
    );
  }
  return { clientId, clientSecret: (b.client_secret as string | undefined) || undefined };
}

export function buildAuthorizeUrl(args: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
}): string {
  const u = new URL(args.authorizationEndpoint);
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("scope", args.scope ?? "api");
  u.searchParams.set("state", args.state);
  u.searchParams.set("code_challenge", args.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

async function postToken(
  tokenEndpoint: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const res = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  const parsed = text ? safeJson(text) : {};
  if (!res.ok) {
    throw new TwentyApiError(`Twenty OAuth token request failed (${res.status})`, res.status, parsed, tokenEndpoint);
  }
  const b = asObject(parsed);
  const accessToken = b.access_token as string | undefined;
  if (!accessToken) {
    throw new TwentyApiError("Twenty OAuth token response had no access_token", res.status, parsed, tokenEndpoint);
  }
  return {
    accessToken,
    refreshToken: b.refresh_token as string | undefined,
    expiresIn: b.expires_in as number | undefined,
  };
}

export function exchangeCode(
  args: {
    tokenEndpoint: string;
    clientId: string;
    clientSecret?: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const params: Record<string, string> = {
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    code_verifier: args.codeVerifier,
  };
  if (args.clientSecret) params.client_secret = args.clientSecret;
  return postToken(args.tokenEndpoint, params, fetchImpl);
}

export function refreshToken(
  args: { tokenEndpoint: string; clientId: string; clientSecret?: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const params: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
  };
  if (args.clientSecret) params.client_secret = args.clientSecret;
  return postToken(args.tokenEndpoint, params, fetchImpl);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
