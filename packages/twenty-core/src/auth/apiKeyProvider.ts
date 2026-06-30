import type { CredentialProvider } from "./types.js";

/** Static API-key credential: the key is the bearer, with no refresh. */
export class ApiKeyProvider implements CredentialProvider {
  constructor(private readonly apiKey: string) {}

  async getBearer(): Promise<string> {
    return this.apiKey;
  }
}
