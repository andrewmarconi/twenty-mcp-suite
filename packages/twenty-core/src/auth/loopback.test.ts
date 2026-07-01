import { describe, it, expect } from "vitest";
import { parseCallback } from "./loopback.js";

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
