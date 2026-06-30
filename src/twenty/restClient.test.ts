import { describe, it, expect, vi } from "vitest";
import { RestClient } from "./restClient.js";
import { TwentyApiError } from "./errors.js";

const cfg = { baseUrl: "https://crm.example.com", apiKey: "k" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("RestClient", () => {
  it("builds the URL, sets auth header, and returns parsed JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: { people: [] } }));
    const client = new RestClient(cfg, fetchImpl as unknown as typeof fetch);

    const result = await client.get("/rest/people", { limit: 10, cursor: undefined });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://crm.example.com/rest/people?limit=10");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(result).toEqual({ data: { people: [] } });
  });

  it("throws TwentyApiError with status and body on non-2xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { messages: ["not found"] }));
    const client = new RestClient(cfg, fetchImpl as unknown as typeof fetch);

    await expect(client.get("/rest/widgets")).rejects.toMatchObject({
      status: 404,
      body: { messages: ["not found"] },
    } satisfies Partial<TwentyApiError>);
  });

  it("sends a JSON body on post", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { data: {} }));
    const client = new RestClient(cfg, fetchImpl as unknown as typeof fetch);

    await client.post("/rest/people", { name: "Ada" });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Ada" });
  });
});
