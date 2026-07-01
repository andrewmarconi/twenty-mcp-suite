import { existsSync, readFileSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { ApiKeyProvider } from "./apiKeyProvider.js";
import { OAuthProvider } from "./oauthProvider.js";
import { FileTokenStore, defaultConfigDir, type TokenStore } from "./tokenStore.js";
import type { Connection } from "./types.js";

export interface ConnectionConfig {
  baseUrl: string;
  env?: string;
  auth: "apikey" | "oauth";
}

export interface RegistryFile {
  defaultConnection?: string;
  connections: Record<string, ConnectionConfig>;
}

function stripTrailingSlash(url: string): string {
  // Linear trailing-slash trim (avoids ReDoS from an unanchored `/\/+$/` search).
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47 /* "/" */) end--;
  return url.slice(0, end);
}

export function envKeyForLabel(label: string): string {
  return "TWENTY_API_KEY_" + label.toUpperCase().replace(/-/g, "_");
}

export function legacyConnectionFromEnv(env: NodeJS.ProcessEnv): Connection | null {
  const baseUrl = env.TWENTY_BASE_URL?.trim();
  const apiKey = env.TWENTY_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  const provider = new ApiKeyProvider(apiKey);
  return {
    label: "default",
    baseUrl: stripTrailingSlash(baseUrl),
    getBearer: () => provider.getBearer(),
  };
}

export function connectionsPath(env: NodeJS.ProcessEnv): string {
  return env.TWENTY_MCP_CONFIG?.trim() ?? join(defaultConfigDir(env), "connections.json");
}

export function loadRegistryFile(path: string): RegistryFile | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as RegistryFile;
}

export function saveRegistryFile(path: string, reg: RegistryFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(reg, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function upsertConnection(
  reg: RegistryFile,
  label: string,
  cfg: ConnectionConfig,
): RegistryFile {
  return { ...reg, connections: { ...reg.connections, [label]: cfg } };
}

export function removeConnection(reg: RegistryFile, label: string): RegistryFile {
  const connections = { ...reg.connections };
  delete connections[label];
  const next: RegistryFile = { ...reg, connections };
  if (next.defaultConnection === label) delete next.defaultConnection;
  return next;
}

export function setDefaultConnection(reg: RegistryFile, label: string): RegistryFile {
  return { ...reg, defaultConnection: label };
}

export function buildConnectionFromConfig(
  label: string,
  cfg: ConnectionConfig,
  env: NodeJS.ProcessEnv,
  store?: TokenStore,
): Connection {
  if (cfg.auth === "oauth") {
    const tokenStore = store ?? new FileTokenStore(defaultConfigDir(env));
    const provider = new OAuthProvider({
      label,
      store: tokenStore,
    });
    return {
      label,
      baseUrl: stripTrailingSlash(cfg.baseUrl),
      env: cfg.env,
      getBearer: () => provider.getBearer(),
    };
  }
  const perLabel = envKeyForLabel(label);
  const apiKey = env[perLabel]?.trim() || env.TWENTY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      `No API key for connection "${label}". Set ${perLabel} (or TWENTY_API_KEY) in the environment.`,
    );
  }
  const apiProvider = new ApiKeyProvider(apiKey);
  return {
    label,
    baseUrl: stripTrailingSlash(cfg.baseUrl),
    env: cfg.env,
    getBearer: () => apiProvider.getBearer(),
  };
}

export function resolveActiveConnection(
  env: NodeJS.ProcessEnv,
  opts?: { registry?: RegistryFile; store?: TokenStore; configPath?: string },
): Connection {
  const registry =
    opts?.registry ?? loadRegistryFile(opts?.configPath ?? connectionsPath(env));

  if (registry) {
    const label = env.TWENTY_CONNECTION?.trim() || registry.defaultConnection;
    if (!label) {
      throw new Error(
        "No active connection. Set TWENTY_CONNECTION or a defaultConnection in the registry.",
      );
    }
    const cfg = registry.connections[label];
    if (!cfg) {
      throw new Error(
        `Unknown connection "${label}". Known connections: ${Object.keys(registry.connections).join(", ") || "(none)"}.`,
      );
    }
    return buildConnectionFromConfig(label, cfg, env, opts?.store);
  }

  const legacy = legacyConnectionFromEnv(env);
  if (legacy) return legacy;

  throw new Error(
    "No Twenty connection configured. Set TWENTY_BASE_URL and TWENTY_API_KEY, " +
      "or provide a connection registry.",
  );
}
