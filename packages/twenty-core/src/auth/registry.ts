import { ApiKeyProvider } from "./apiKeyProvider.js";
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
  return url.replace(/\/+$/, "");
}

function envKeyForLabel(label: string): string {
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

export function buildConnectionFromConfig(
  label: string,
  cfg: ConnectionConfig,
  env: NodeJS.ProcessEnv,
): Connection {
  if (cfg.auth === "oauth") {
    throw new Error(
      `Connection "${label}" uses OAuth, which is not supported until Plan 2. ` +
        `Use an apikey connection for now.`,
    );
  }
  const perLabel = envKeyForLabel(label);
  const apiKey = env[perLabel]?.trim() || env.TWENTY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      `No API key for connection "${label}". Set ${perLabel} (or TWENTY_API_KEY) in the environment.`,
    );
  }
  const provider = new ApiKeyProvider(apiKey);
  return {
    label,
    baseUrl: stripTrailingSlash(cfg.baseUrl),
    env: cfg.env,
    getBearer: () => provider.getBearer(),
  };
}

export function resolveActiveConnection(
  env: NodeJS.ProcessEnv,
  opts?: { registry?: RegistryFile },
): Connection {
  const registry = opts?.registry;
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
    return buildConnectionFromConfig(label, cfg, env);
  }

  const legacy = legacyConnectionFromEnv(env);
  if (legacy) return legacy;

  throw new Error(
    "No Twenty connection configured. Set TWENTY_BASE_URL and TWENTY_API_KEY, " +
      "or provide a connection registry.",
  );
}
