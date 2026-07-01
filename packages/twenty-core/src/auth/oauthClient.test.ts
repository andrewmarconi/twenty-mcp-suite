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
