import { describe, it, expect } from "vitest";
import { parseCallback, startLoopback } from "./loopback.js";

describe("parseCallback", () => {
  it("extracts code and state from the callback path", () => {
    expect(parseCallback("/callback?code=abc&state=xyz")).toEqual({
      code: "abc",
      state: "xyz",
    });
  });

  it("surfaces an OAuth error param", () => {
    expect(parseCallback("/callback?error=access_denied")).toEqual({
      error: "access_denied",
    });
  });

  it("returns empty fields for an unrelated path", () => {
    expect(parseCallback("/favicon.ico")).toEqual({});
  });
});

describe("startLoopback", () => {
  it("close() rejects a pending waitForCode", async () => {
    const server = await startLoopback(0); // OS-assigned port
    const pending = server.waitForCode("state");
    server.close();
    await expect(pending).rejects.toThrow(/cancel/i);
  });
});
