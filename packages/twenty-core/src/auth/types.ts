/** Yields a valid (later auto-refreshed) bearer token for Twenty API calls. */
export interface CredentialProvider {
  getBearer(): Promise<string>;
}

/** A resolved, named Twenty endpoint plus its credential provider. */
export interface Connection {
  label: string;
  baseUrl: string;
  env?: string;
  getBearer(): Promise<string>;
}
