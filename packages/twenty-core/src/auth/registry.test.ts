import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  legacyConnectionFromEnv,
  buildConnectionFromConfig,
  resolveActiveConnection,
  loadRegistryFile,
} from "./registry.js";
import type { RegistryFile } from "./registry.js";
import type { TokenStore, TokenRecord } from "./tokenStore.js";

function memStore(rec: TokenRecord | null): TokenStore {
  return {
    get: async () => rec,
    set: async () => {},
    delete: async () => {},
    labels: async () => (rec ? ["acme-oauth"] : []),
  };
}

const registry: RegistryFile = {
  defaultConnection: "acme-prod",
  connections: {
    "acme-prod": { baseUrl: "https://crm.acme.com", env: "prod", auth: "apikey" },
    "acme-oauth": { baseUrl: "https://oauth.acme.com", env: "prod", auth: "oauth" },
  },
};

describe("legacyConnectionFromEnv", () => {
  it("synthesizes a 'default' connection from TWENTY_BASE_URL + TWENTY_API_KEY and strips the trailing slash", async () => {
    const conn = legacyConnectionFromEnv({
      TWENTY_BASE_URL: "https://crm.example.com/",
      TWENTY_API_KEY: "k",
    });
    expect(conn).not.toBeNull();
    expect(conn!.label).toBe("default");
    expect(conn!.baseUrl).toBe("https://crm.example.com");
    expect(await conn!.getBearer()).toBe("k");
  });

  it("returns null when the legacy env vars are absent", () => {
    expect(legacyConnectionFromEnv({})).toBeNull();
  });
});

describe("buildConnectionFromConfig", () => {
  it("reads the per-label API key TWENTY_API_KEY_<LABEL>", async () => {
    const conn = buildConnectionFromConfig("acme-prod", registry.connections["acme-prod"], {
      TWENTY_API_KEY_ACME_PROD: "acme-key",
    });
    expect(conn.baseUrl).toBe("https://crm.acme.com");
    expect(await conn.getBearer()).toBe("acme-key");
  });

  it("falls back to TWENTY_API_KEY when no per-label key is set", async () => {
    const conn = buildConnectionFromConfig("acme-prod", registry.connections["acme-prod"], {
      TWENTY_API_KEY: "shared-key",
    });
    expect(await conn.getBearer()).toBe("shared-key");
  });

  it("throws an actionable error when an apikey connection has no key", () => {
    expect(() => buildConnectionFromConfig("acme-prod", registry.connections["acme-prod"], {})).toThrow(
      /TWENTY_API_KEY_ACME_PROD/,
    );
  });
});

describe("resolveActiveConnection", () => {
  it("picks TWENTY_CONNECTION from the registry", async () => {
    const conn = resolveActiveConnection(
      { TWENTY_CONNECTION: "acme-prod", TWENTY_API_KEY_ACME_PROD: "acme-key" },
      { registry },
    );
    expect(conn.label).toBe("acme-prod");
    expect(await conn.getBearer()).toBe("acme-key");
  });

  it("falls back to the registry defaultConnection", () => {
    const conn = resolveActiveConnection({ TWENTY_API_KEY_ACME_PROD: "acme-key" }, { registry });
    expect(conn.label).toBe("acme-prod");
  });

  it("throws when TWENTY_CONNECTION names an unknown label", () => {
    expect(() =>
      resolveActiveConnection({ TWENTY_CONNECTION: "nope" }, { registry }),
    ).toThrow(/nope/);
  });

  it("uses the legacy env when no registry is provided", async () => {
    const conn = resolveActiveConnection({ TWENTY_BASE_URL: "https://x", TWENTY_API_KEY: "k" });
    expect(conn.label).toBe("default");
    expect(await conn.getBearer()).toBe("k");
  });

  it("throws an actionable error when nothing is configured", () => {
    expect(() => resolveActiveConnection({})).toThrow(/TWENTY_BASE_URL/);
  });
});

describe("loadRegistryFile", () => {
  it("returns null when the file is absent", () => {
    expect(loadRegistryFile(join(tmpdir(), "nope-does-not-exist.json"))).toBeNull();
  });

  it("parses a registry file", () => {
    const dir = mkdtempSync(join(tmpdir(), "twenty-reg-"));
    const path = join(dir, "connections.json");
    writeFileSync(
      path,
      JSON.stringify({
        defaultConnection: "acme-oauth",
        connections: { "acme-oauth": { baseUrl: "https://crm.acme.com", auth: "oauth" } },
      }),
    );
    const reg = loadRegistryFile(path);
    expect(reg?.defaultConnection).toBe("acme-oauth");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("oauth connections", () => {
  const registry = {
    connections: { "acme-oauth": { baseUrl: "https://crm.acme.com/", auth: "oauth" as const } },
    defaultConnection: "acme-oauth",
  };

  it("builds an oauth Connection whose getBearer refreshes via the stored record", async () => {
    const conn = resolveActiveConnection(
      { TWENTY_CONNECTION: "acme-oauth" },
      {
        registry,
        store: memStore({
          clientId: "cid",
          clientSecret: "csec",
          refreshToken: "rt",
          accessToken: "live",
          expiresAt: Number.MAX_SAFE_INTEGER,
        }),
      },
    );
    expect(conn.label).toBe("acme-oauth");
    expect(conn.baseUrl).toBe("https://crm.acme.com");
    expect(await conn.getBearer()).toBe("live");
  });

  it("an oauth connection with no stored login yields an actionable getBearer error", async () => {
    const conn = resolveActiveConnection(
      { TWENTY_CONNECTION: "acme-oauth" },
      { registry, store: memStore(null) },
    );
    await expect(conn.getBearer()).rejects.toThrow(/twenty-mcp login acme-oauth/);
  });
});
