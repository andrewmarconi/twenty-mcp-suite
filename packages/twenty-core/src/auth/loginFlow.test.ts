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
