import { randomBytes, createHash } from "node:crypto";

/** RFC 7636 code verifier: 32 random bytes as base64url (43 chars). */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** RFC 7636 S256 challenge: base64url(SHA-256(verifier)). */
export function codeChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
