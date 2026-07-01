import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { generateCodeVerifier, codeChallengeS256 } from "./pkce.js";

describe("pkce", () => {
  it("generates a base64url verifier of legal length (43-128 chars, no +/= )", () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("produces two different verifiers on successive calls", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });

  it("computes the S256 challenge as base64url(sha256(verifier))", () => {
    const verifier = "test-verifier-string-1234567890-abcdefghij";
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(codeChallengeS256(verifier)).toBe(expected);
  });
});
