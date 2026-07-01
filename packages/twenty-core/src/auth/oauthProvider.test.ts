import { describe, it, expect, vi } from "vitest";
import { OAuthProvider } from "./oauthProvider.js";
import type { TokenRecord, TokenStore } from "./tokenStore.js";

function memStore(initial?: TokenRecord): TokenStore {
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
  };
}

const base: TokenRecord = {
  clientId: "cid",
  clientSecret: "csec",
  refreshToken: "rt",
};

describe("OAuthProvider", () => {
  it("throws an actionable login hint when no record is stored", async () => {
    const p = new OAuthProvider({ label: "acme", baseUrl: "https://x", store: memStore() });
    await expect(p.getBearer()).rejects.toThrow(/twenty-mcp login acme/);
  });

  it("returns a cached, unexpired access token without refreshing", async () => {
    const refreshFn = vi.fn();
    const store = memStore({ ...base, accessToken: "good", expiresAt: 50_000 });
    const p = new OAuthProvider({
      label: "acme",
      baseUrl: "https://x",
      store,
      now: () => 5_000,
      refreshFn: refreshFn as never,
    });
    expect(await p.getBearer()).toBe("good");
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it("refreshes when the access token is expired and persists the rotated tokens", async () => {
    const refreshFn = vi
      .fn()
      .mockResolvedValue({ accessToken: "fresh", refreshToken: "rt2", expiresIn: 3600 });
    const store = memStore({ ...base, accessToken: "stale", expiresAt: 1_000 });
    const setSpy = vi.spyOn(store, "set");
    const p = new OAuthProvider({
      label: "acme",
      baseUrl: "https://x",
      store,
      now: () => 5_000,
      refreshFn: refreshFn as never,
    });
    expect(await p.getBearer()).toBe("fresh");
    expect(refreshFn).toHaveBeenCalledWith({
      baseUrl: "https://x",
      clientId: "cid",
      clientSecret: "csec",
      refreshToken: "rt",
    });
    expect(setSpy).toHaveBeenCalled();
    // rotated refresh token persisted
    expect((await store.get("acme"))!.refreshToken).toBe("rt2");
  });

  it("refreshes when there is a refresh token but no access token yet", async () => {
    const refreshFn = vi
      .fn()
      .mockResolvedValue({ accessToken: "fresh", expiresIn: 3600 });
    const p = new OAuthProvider({
      label: "acme",
      baseUrl: "https://x",
      store: memStore({ ...base }),
      now: () => 0,
      refreshFn: refreshFn as never,
    });
    expect(await p.getBearer()).toBe("fresh");
  });

  it("defaults a short TTL when a refresh response omits expiresIn, and caches within it", async () => {
    const refreshFn = vi.fn().mockResolvedValue({ accessToken: "fresh" });
    const store = memStore({ ...base, accessToken: "stale", expiresAt: 1_000 });
    const p = new OAuthProvider({
      label: "acme",
      baseUrl: "https://x",
      store,
      now: () => 5_000,
      refreshFn: refreshFn as never,
    });
    expect(await p.getBearer()).toBe("fresh");
    const rec = (await store.get("acme"))!;
    expect(rec.expiresAt).toBe(5_000 + 300 * 1000);
    expect(refreshFn).toHaveBeenCalledTimes(1);

    // A subsequent call before the default TTL expires should use the cache, not refresh again.
    expect(await p.getBearer()).toBe("fresh");
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });
});
