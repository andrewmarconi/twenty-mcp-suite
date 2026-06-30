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
    const parsed = text ? safeJson(text) : {};
    if (!res.ok) {
      throw new TwentyApiError(`Twenty GraphQL failed (${res.status})`, res.status, parsed, url);
    }
    const data = parsed as { errors?: unknown; data?: unknown };
    if (data.errors) {
      throw new TwentyApiError("Twenty GraphQL returned errors", res.status, data.errors, url);
    }
    return data.data;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
