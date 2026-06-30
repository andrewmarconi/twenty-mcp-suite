import type { TwentyConfig } from "../config.js";
import { TwentyApiError } from "./errors.js";

type Query = Record<string, string | number | undefined>;

export class RestClient {
  constructor(
    private readonly config: TwentyConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get(path: string, query?: Query): Promise<unknown> {
    return this.request("GET", path, undefined, query);
  }
  post(path: string, body: unknown): Promise<unknown> {
    return this.request("POST", path, body);
  }
  patch(path: string, body: unknown): Promise<unknown> {
    return this.request("PATCH", path, body);
  }
  del(path: string): Promise<unknown> {
    return this.request("DELETE", path);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    query?: Query,
  ): Promise<unknown> {
    const url = new URL(this.config.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    const res = await this.fetchImpl(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!res.ok) {
      throw new TwentyApiError(
        `Twenty REST ${method} ${path} failed (${res.status})`,
        res.status,
        parsed ?? text,
        url.toString(),
      );
    }
    return parsed;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
