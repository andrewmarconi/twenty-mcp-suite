import type { CredentialProvider } from "./types.js";
import type { TokenStore } from "./tokenStore.js";

/** Static API-key credential: the key is the bearer, with no refresh. */
export class ApiKeyProvider implements CredentialProvider {
  constructor(private readonly apiKey: string) {}

  async getBearer(): Promise<string> {
    return this.apiKey;
  }
}

/** API key resolved lazily from the encrypted token store (env vars take precedence upstream). */
export class StoredApiKeyProvider implements CredentialProvider {
  constructor(
    private readonly label: string,
    private readonly store: TokenStore,
    private readonly envKeyName: string,
  ) {}

  async getBearer(): Promise<string> {
    const rec = await this.store.get(this.label);
    if (rec?.kind === "apikey") return rec.apiKey;
    throw new Error(
      `No API key for connection "${this.label}". Set ${this.envKeyName} (or TWENTY_API_KEY) ` +
        `in the environment, or store one with: twenty-mcp login ${this.label}`,
    );
  }
}
