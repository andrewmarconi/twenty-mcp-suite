import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  statSync,
  chmodSync,
  readdirSync,
  unlinkSync,
  utimesSync,
  existsSync,
} from "node:fs";
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
  tokenEndpoint: "https://crm.example.com/oauth/token",
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
    expect(await store.labels()).toEqual(["b"]);
  });

  it("a second store instance on the same dir decrypts existing records", async () => {
    await new FileTokenStore(dir).set("acme", rec);
    expect(await new FileTokenStore(dir).get("acme")).toEqual(rec);
  });

  it("throws a descriptive error when tokens.json is corrupt (invalid JSON)", async () => {
    const store = new FileTokenStore(dir);
    await store.set("acme", rec);
    writeFileSync(join(dir, "tokens.json"), "{ not valid json", "utf8");
    await expect(store.get("acme")).rejects.toThrow(/corrupt|invalid/i);
  });

  it("throws a descriptive error when a record's ciphertext is tampered with", async () => {
    const store = new FileTokenStore(dir);
    await store.set("acme", rec);
    const dataPath = join(dir, "tokens.json");
    const all = JSON.parse(readFileSync(dataPath, "utf8"));
    // Flip the stored ciphertext so GCM auth-tag verification fails.
    all.acme.ct = Buffer.from("tampered-ciphertext-bytes!!").toString("base64");
    writeFileSync(dataPath, JSON.stringify(all, null, 2), "utf8");
    await expect(store.get("acme")).rejects.toThrow(/corrupt|tamper/i);
  });

  it("throws a descriptive error when a record's auth tag is tampered with", async () => {
    const store = new FileTokenStore(dir);
    await store.set("acme", rec);
    const dataPath = join(dir, "tokens.json");
    const all = JSON.parse(readFileSync(dataPath, "utf8"));
    all.acme.tag = Buffer.from(Array(16).fill(0)).toString("base64");
    writeFileSync(dataPath, JSON.stringify(all, null, 2), "utf8");
    await expect(store.get("acme")).rejects.toThrow(/corrupt|tamper/i);
  });

  it("throws a descriptive error when store.key is not 32 bytes", async () => {
    const store = new FileTokenStore(dir);
    await store.set("acme", rec); // creates a valid store.key on first write
    writeFileSync(join(dir, "store.key"), Buffer.from("too-short"));
    const fresh = new FileTokenStore(dir);
    await expect(fresh.get("acme")).rejects.toThrow(/key/i);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));
});

describe("FileTokenStore — atomic writes", () => {
  it("re-asserts 0600 on tokens.json even if permissions drifted", async () => {
    const store = new FileTokenStore(dir);
    await store.set("acme", rec);
    chmodSync(join(dir, "tokens.json"), 0o644);
    await store.set("other", rec);
    const mode = statSync(join(dir, "tokens.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("leaves no temp files behind after writes", async () => {
    const store = new FileTokenStore(dir);
    await store.set("acme", rec);
    await store.delete("acme");
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));
});

describe("FileTokenStore — lockfile", () => {
  const lockPath = () => join(dir, "tokens.json.lock");

  it("set() waits for an existing lock and proceeds once it is released", async () => {
    const store = new FileTokenStore(dir, { lockRetryMs: 5 });
    writeFileSync(lockPath(), "999999", { flag: "wx" });
    const pending = store.set("acme", rec);
    await new Promise((r) => setTimeout(r, 30));
    expect(await new FileTokenStore(dir).get("acme")).toBeNull(); // still blocked
    unlinkSync(lockPath());
    await pending;
    expect(await new FileTokenStore(dir).get("acme")).toEqual(rec);
  });

  it("breaks a stale lock and proceeds", async () => {
    writeFileSync(lockPath(), "999999", { flag: "wx" });
    const past = new Date(Date.now() - 60_000);
    utimesSync(lockPath(), past, past);
    const store = new FileTokenStore(dir, { lockRetryMs: 5, lockStaleMs: 10_000 });
    await store.set("acme", rec);
    expect(await store.get("acme")).toEqual(rec);
  });

  it("times out with an actionable error when the lock never frees", async () => {
    writeFileSync(lockPath(), "999999", { flag: "wx" });
    const store = new FileTokenStore(dir, {
      lockRetryMs: 5,
      lockTimeoutMs: 50,
      lockStaleMs: 60_000,
    });
    await expect(store.set("acme", rec)).rejects.toThrow(/lock/i);
  });

  it("removes the lock file after set() and delete()", async () => {
    const store = new FileTokenStore(dir);
    await store.set("acme", rec);
    expect(existsSync(lockPath())).toBe(false);
    await store.delete("acme");
    expect(existsSync(lockPath())).toBe(false);
  });

  it("concurrent set()s from two instances both land", async () => {
    const a = new FileTokenStore(dir, { lockRetryMs: 5 });
    const b = new FileTokenStore(dir, { lockRetryMs: 5 });
    await Promise.all([a.set("a", rec), b.set("b", rec)]);
    expect((await a.labels()).sort()).toEqual(["a", "b"]);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));
});
