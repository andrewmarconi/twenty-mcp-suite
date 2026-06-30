import type { TwentyConfig } from "../config.js";
import { TwentyApiError } from "./errors.js";

export class GraphQLClient {
  constructor(
    private readonly config: TwentyConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const url = `${this.config.baseUrl}/graphql`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new TwentyApiError(`Twenty GraphQL failed (${res.status})`, res.status, parsed, url);
    }
    if (parsed.errors) {
      throw new TwentyApiError("Twenty GraphQL returned errors", res.status, parsed.errors, url);
    }
    return parsed.data;
  }
}
