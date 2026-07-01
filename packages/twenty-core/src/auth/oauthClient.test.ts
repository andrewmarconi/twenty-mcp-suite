import { describe, it, expect, vi } from "vitest";
import {
  discoverOAuth,
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

describe("discoverOAuth", () => {
  it("fetches the RFC 8414 discovery document and maps the endpoints", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonRes(200, {
        authorization_endpoint: "https://crm.example.com/authorize",
        token_endpoint: "https://crm.example.com/oauth/token",
        registration_endpoint: "https://crm.example.com/oauth/register",
        token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
        scopes_supported: ["api", "profile"],
        code_challenge_methods_supported: ["S256"],
      }),
    );
    const out = await discoverOAuth("https://crm.example.com", fetchImpl as unknown as typeof fetch);
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://crm.example.com/.well-known/oauth-authorization-server");
    expect(out).toEqual({
      authorizationEndpoint: "https://crm.example.com/authorize",
      tokenEndpoint: "https://crm.example.com/oauth/token",
      registrationEndpoint: "https://crm.example.com/oauth/register",
      tokenEndpointAuthMethods: ["client_secret_post", "none"],
    });
  });

  it("throws when the discovery document is missing authorization_endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonRes(200, {
        token_endpoint: "https://crm.example.com/oauth/token",
        registration_endpoint: "https://crm.example.com/oauth/register",
      }),
    );
    await expect(
      discoverOAuth("https://crm.example.com", fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ status: 200 });
  });

  it("throws TwentyApiError on a non-2xx discovery response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(404, { error: "not_found" }));
    await expect(
      discoverOAuth("https://crm.example.com", fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("registerClient", () => {
  it("registers a public (PKCE-only) client when the server issues no client_secret", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(200, { client_id: "cid", token_endpoint_auth_method: "none" }));
    const out = await registerClient(
      "https://crm.example.com/oauth/register",
      "http://localhost:52333/callback",
      "none",
      fetchImpl as unknown as typeof fetch,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://crm.example.com/oauth/register");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.redirect_uris).toEqual(["http://localhost:52333/callback"]);
    expect(body.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(out).toEqual({ clientId: "cid", clientSecret: undefined });
  });

  it("registers a confidential client and returns the client_secret when issued", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonRes(200, { client_id: "cid", client_secret: "csec" }));
    const out = await registerClient(
      "https://crm.example.com/oauth/register",
      "http://localhost:52333/callback",
      "client_secret_post",
      fetchImpl as unknown as typeof fetch,
    );
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.token_endpoint_auth_method).toBe("client_secret_post");
    expect(out).toEqual({ clientId: "cid", clientSecret: "csec" });
  });

  it("throws TwentyApiError when the response has no client_id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(200, {}));
    await expect(
      registerClient(
        "https://crm.example.com/oauth/register",
        "http://localhost:52333/callback",
        "none",
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ status: 200 });
  });
});

describe("exchangeCode", () => {
  it("exchanges a code as form-urlencoded, omitting client_secret when not provided (public client)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonRes(200, { access_token: "at", refresh_token: "rt", expires_in: 3600 }),
    );
    const out = await exchangeCode(
      {
        tokenEndpoint: "https://crm.example.com/oauth/token",
        clientId: "cid",
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
    expect(params.has("client_secret")).toBe(false);
    expect(params.get("code_verifier")).toBe("verifier");
    expect(out).toEqual({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 });
  });

  it("includes client_secret when provided (confidential client)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(200, { access_token: "at" }));
    await exchangeCode(
      {
        tokenEndpoint: "https://crm.example.com/oauth/token",
        clientId: "cid",
        clientSecret: "csec",
        code: "authcode",
        redirectUri: "http://localhost:52333/callback",
        codeVerifier: "verifier",
      },
      fetchImpl as unknown as typeof fetch,
    );
    const params = new URLSearchParams((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(params.get("client_secret")).toBe("csec");
  });
});

describe("refreshToken", () => {
  it("refreshes using the refresh_token grant, posting to the given tokenEndpoint, without client_secret", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonRes(200, { access_token: "at2", expires_in: 3600 }));
    const out = await refreshToken(
      {
        tokenEndpoint: "https://crm.example.com/oauth/token",
        clientId: "cid",
        refreshToken: "rt",
      },
      fetchImpl as unknown as typeof fetch,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://crm.example.com/oauth/token");
    const params = new URLSearchParams((init as RequestInit).body as string);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("rt");
    expect(params.has("client_secret")).toBe(false);
    expect(out.accessToken).toBe("at2");
  });

  it("includes client_secret when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(200, { access_token: "at2" }));
    await refreshToken(
      {
        tokenEndpoint: "https://crm.example.com/oauth/token",
        clientId: "cid",
        clientSecret: "csec",
        refreshToken: "rt",
      },
      fetchImpl as unknown as typeof fetch,
    );
    const params = new URLSearchParams(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(params.get("client_secret")).toBe("csec");
  });

  it("throws TwentyApiError on a non-2xx token response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(401, { error: "invalid_grant" }));
    await expect(
      refreshToken(
        { tokenEndpoint: "https://x/oauth/token", clientId: "c", refreshToken: "r" },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("buildAuthorizeUrl", () => {
  it("uses the discovered authorizationEndpoint verbatim (no /oauth prefix appended)", () => {
    const url = buildAuthorizeUrl({
      authorizationEndpoint: "https://crm.example.com/authorize",
      clientId: "cid",
      redirectUri: "http://localhost:52333/callback",
      state: "st",
      codeChallenge: "chal",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://crm.example.com/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("api");
    expect(u.searchParams.get("code_challenge")).toBe("chal");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBe("st");
  });
});
