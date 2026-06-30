import { describe, it, expect } from "vitest";
import { ApiKeyProvider } from "./apiKeyProvider.js";

describe("ApiKeyProvider", () => {
  it("returns the configured key as the bearer", async () => {
    const provider = new ApiKeyProvider("secret-key");
    expect(await provider.getBearer()).toBe("secret-key");
  });
});
