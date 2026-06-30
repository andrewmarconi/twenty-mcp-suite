import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("reads and normalizes a valid env", () => {
    const cfg = loadConfig({
      TWENTY_BASE_URL: "https://crm.example.com/",
      TWENTY_API_KEY: "abc123",
    });
    expect(cfg.baseUrl).toBe("https://crm.example.com");
    expect(cfg.apiKey).toBe("abc123");
  });

  it("throws when TWENTY_API_KEY is missing", () => {
    expect(() => loadConfig({ TWENTY_BASE_URL: "https://x" })).toThrow(
      /TWENTY_API_KEY/,
    );
  });

  it("throws when TWENTY_BASE_URL is missing", () => {
    expect(() => loadConfig({ TWENTY_API_KEY: "k" })).toThrow(
      /TWENTY_BASE_URL/,
    );
  });
});
