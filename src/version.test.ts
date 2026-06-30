import { describe, it, expect } from "vitest";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

describe("version", () => {
  it("exposes a server name and semver version", () => {
    expect(SERVER_NAME).toBe("twentycrm-mcp");
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
