import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTokenStore, type TokenRecord } from "./tokenStore.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "twenty-store-"));
});

const rec: TokenRecord = {
  clientId: "cid",
  clientSecret: "csecret",
  refreshToken: "rtok",
  accessToken: "atok",
  expiresAt: 123,
};

describe("FileTokenStore", () => {
  it("round-trips a record and returns null for unknown labels", async () => {
    const store = new FileTokenStore(dir);
    expect(await store.get("acme")).toBeNull();
    await store.set("acme", rec);
    expect(await store.get("acme")).toEqual(rec);
  });

  it("persists ciphertext, not plaintext secrets, on disk", async () => {
    const store = new FileTokenStore(dir);
    await store.set("acme", rec);
    const raw = readFileSync(join(dir, "tokens.json"), "utf8");
    expect(raw).not.toContain("rtok");
    expect(raw).not.toContain("csecret");
  });

  it("creates the key file with 0600 permissions", async () => {
    const store = new FileTokenStore(dir);
    await store.set("acme", rec);
    const mode = statSync(join(dir, "store.key")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("lists and deletes labels", async () => {
    const store = new FileTokenStore(dir);
    await store.set("a", rec);
    await store.set("b", rec);
    expect((await store.labels()).sort()).toEqual(["a", "b"]);
    await store.delete("a");
    expect(await store.get("a")).toBeNull();
    expect((await store.labels())).toEqual(["b"]);
  });

  it("a second store instance on the same dir decrypts existing records", async () => {
    await new FileTokenStore(dir).set("acme", rec);
    expect(await new FileTokenStore(dir).get("acme")).toEqual(rec);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));
});
