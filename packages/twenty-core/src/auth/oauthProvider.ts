import type { CredentialProvider } from "./types.js";
import type { TokenStore } from "./tokenStore.js";
import { refreshToken as defaultRefresh, DEFAULT_TOKEN_TTL_SECONDS } from "./oauthClient.js";

export class OAuthProvider implements CredentialProvider {
  private readonly label: string;
  private readonly store: TokenStore;
  private readonly now: () => number;
  private readonly refreshFn: typeof defaultRefresh;
  private readonly skewMs: number;

  constructor(args: {
    label: string;
    store: TokenStore;
    now?: () => number;
    refreshFn?: typeof defaultRefresh;
    skewMs?: number;
  }) {
    this.label = args.label;
    this.store = args.store;
    this.now = args.now ?? (() => Date.now());
    this.refreshFn = args.refreshFn ?? defaultRefresh;
    this.skewMs = args.skewMs ?? 30_000;
  }

  async getBearer(): Promise<string> {
    const rec = await this.store.get(this.label);
    if (!rec) {
      throw new Error(
        `Not signed in to connection "${this.label}". Run: twenty-mcp login ${this.label}`,
      );
    }
    if (rec.kind !== "oauth") {
      throw new Error(
        `Stored credential for "${this.label}" is an API key, but the connection is ` +
          `configured for OAuth. Run: twenty-mcp login ${this.label}`,
      );
    }
    if (rec.accessToken && rec.expiresAt && this.now() < rec.expiresAt - this.skewMs) {
      return rec.accessToken;
    }
    const tokens = await this.refreshFn({
      tokenEndpoint: rec.tokenEndpoint,
      clientId: rec.clientId,
      clientSecret: rec.clientSecret,
      refreshToken: rec.refreshToken,
    });
    const ttlSeconds = tokens.expiresIn ?? DEFAULT_TOKEN_TTL_SECONDS;
    const expiresAt = this.now() + ttlSeconds * 1000;
    await this.store.set(this.label, {
      ...rec,
      refreshToken: tokens.refreshToken ?? rec.refreshToken,
      accessToken: tokens.accessToken,
      expiresAt,
    });
    return tokens.accessToken;
  }
}
