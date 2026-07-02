import { describe, it, expect, vi } from "vitest";
import { loginConnection } from "./loginFlow.js";
import type { StoredCredential, TokenStore } from "./tokenStore.js";
import type { OAuthServerMetadata } from "./oauthClient.js";

function memStore(
  initial?: StoredCredential,
): TokenStore & { current: () => StoredCredential | null } {
  let rec: StoredCredential | null = initial ?? null;
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

const meta: OAuthServerMetadata = {
  authorizationEndpoint: "https://crm.example.com/authorize",
  tokenEndpoint: "https://crm.example.com/oauth/token",
  registrationEndpoint: "https://crm.example.com/oauth/register",
  tokenEndpointAuthMethods: ["client_secret_post", "none"],
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    discover: vi.fn().mockResolvedValue(meta),
    register: vi.fn().mockResolvedValue({ clientId: "cid", clientSecret: undefined }),
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
  it("discovers endpoints, registers a public client, runs the flow, and persists the record", async () => {
    const store = memStore();
    const d = deps();
    await loginConnection(
      { label: "acme", baseUrl: "https://crm.example.com", store, port: 52333 },
      d as never,
    );

    expect(d.discover).toHaveBeenCalledWith("https://crm.example.com");
    expect(d.register).toHaveBeenCalledWith(
      meta.registrationEndpoint,
      "http://localhost:52333/callback",
      "none",
    );
    expect(d.exchange).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenEndpoint: meta.tokenEndpoint,
        clientId: "cid",
        clientSecret: undefined,
        code: "authcode",
        codeVerifier: "verifier",
        redirectUri: "http://localhost:52333/callback",
      }),
    );
    const saved = store.current()!;
    expect(saved.kind).toBe("oauth");
    if (saved.kind !== "oauth") throw new Error("unreachable");
    expect(saved.refreshToken).toBe("rt");
    expect(saved.clientId).toBe("cid");
    expect(saved.clientSecret).toBeUndefined();
    expect(saved.tokenEndpoint).toBe(meta.tokenEndpoint);
    expect(saved.accessToken).toBe("at");
  });

  it("ignores a stored API-key record when looking for an existing client registration", async () => {
    const store = memStore({ kind: "apikey", apiKey: "k" });
    const d = deps();
    await loginConnection({ label: "acme", baseUrl: "https://x", store, port: 52333 }, d as never);
    expect(d.register).toHaveBeenCalled(); // apikey record is not a client registration
    expect(store.current()!.kind).toBe("oauth"); // overwritten by the OAuth login
  });

  it("registers a confidential client when the server does not support 'none'", async () => {
    const confidentialMeta: OAuthServerMetadata = {
      ...meta,
      tokenEndpointAuthMethods: ["client_secret_post"],
    };
    const store = memStore();
    const d = deps({
      discover: vi.fn().mockResolvedValue(confidentialMeta),
      register: vi.fn().mockResolvedValue({ clientId: "cid", clientSecret: "csec" }),
    });
    await loginConnection(
      { label: "acme", baseUrl: "https://crm.example.com", store, port: 52333 },
      d as never,
    );
    expect(d.register).toHaveBeenCalledWith(
      confidentialMeta.registrationEndpoint,
      "http://localhost:52333/callback",
      "client_secret_post",
    );
    const confidential = store.current();
    expect(confidential?.kind === "oauth" ? confidential.clientSecret : undefined).toBe("csec");
  });

  it("reuses stored client credentials instead of registering again", async () => {
    const store = memStore({
      kind: "oauth",
      clientId: "existing",
      clientSecret: "esec",
      tokenEndpoint: "https://crm.example.com/oauth/token",
      refreshToken: "old",
    });
    const d = deps();
    await loginConnection({ label: "acme", baseUrl: "https://x", store, port: 52333 }, d as never);
    expect(d.register).not.toHaveBeenCalled();
    expect(d.exchange).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "existing", clientSecret: "esec" }),
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
      loginConnection(
        { label: "acme", baseUrl: "https://x", store: memStore(), port: 52333 },
        d as never,
      ),
    ).rejects.toThrow("boom");
    expect(close).toHaveBeenCalled();
  });

  it("surfaces a friendly message when the loopback port is already in use", async () => {
    const d = deps({
      startLoopback: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("x"), { code: "EADDRINUSE" })),
    });
    await expect(
      loginConnection(
        { label: "acme", baseUrl: "https://x", store: memStore(), port: 52333 },
        d as never,
      ),
    ).rejects.toThrow(/already in use/);
  });
});
