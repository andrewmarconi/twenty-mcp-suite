import { describe, it, expect } from "vitest";
import { ApiKeyProvider, StoredApiKeyProvider } from "./apiKeyProvider.js";
import type { StoredCredential, TokenStore } from "./tokenStore.js";

function memStore(rec: StoredCredential | null): TokenStore {
  return {
    get: async () => rec,
    set: async () => {},
    delete: async () => {},
    labels: async () => [],
  };
}

describe("ApiKeyProvider", () => {
  it("returns the configured key as the bearer", async () => {
    const provider = new ApiKeyProvider("secret-key");
    expect(await provider.getBearer()).toBe("secret-key");
  });
});

describe("StoredApiKeyProvider", () => {
  it("returns the stored API key", async () => {
    const p = new StoredApiKeyProvider(
      "sandbox",
      memStore({ kind: "apikey", apiKey: "sk-123" }),
      "TWENTY_API_KEY_SANDBOX",
    );
    expect(await p.getBearer()).toBe("sk-123");
  });

  it("throws an actionable error naming both remedies when nothing is stored", async () => {
    const p = new StoredApiKeyProvider("sandbox", memStore(null), "TWENTY_API_KEY_SANDBOX");
    await expect(p.getBearer()).rejects.toThrow(/TWENTY_API_KEY_SANDBOX/);
    await expect(p.getBearer()).rejects.toThrow(/twenty-mcp login sandbox/);
  });

  it("throws when the stored record is an OAuth record, not an API key", async () => {
    const p = new StoredApiKeyProvider(
      "sandbox",
      memStore({
        kind: "oauth",
        clientId: "c",
        tokenEndpoint: "https://x/t",
        refreshToken: "r",
      }),
      "TWENTY_API_KEY_SANDBOX",
    );
    await expect(p.getBearer()).rejects.toThrow(/TWENTY_API_KEY_SANDBOX/);
  });
});
