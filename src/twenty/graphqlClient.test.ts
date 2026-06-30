import { describe, it, expect, vi } from "vitest";
import { GraphQLClient } from "./graphqlClient.js";

const cfg = { baseUrl: "https://crm.example.com", apiKey: "k" };
function res(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("GraphQLClient", () => {
  it("POSTs to /graphql with auth and returns data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, { data: { ok: true } }));
    const client = new GraphQLClient(cfg, fetchImpl as unknown as typeof fetch);
    const out = await client.request("query { x }", { a: 1 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://crm.example.com/graphql");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string)).toEqual({ query: "query { x }", variables: { a: 1 } });
    expect(out).toEqual({ ok: true });
  });

  it("throws when the response contains GraphQL errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, { errors: [{ message: "bad" }] }));
    const client = new GraphQLClient(cfg, fetchImpl as unknown as typeof fetch);
    await expect(client.request("q", {})).rejects.toMatchObject({ status: 200 });
  });

  it("throws TwentyApiError on a non-2xx transport response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(500, { messages: ["boom"] }));
    const client = new GraphQLClient(cfg, fetchImpl as unknown as typeof fetch);
    await expect(client.request("q", {})).rejects.toMatchObject({
      status: 500,
      body: { messages: ["boom"] },
    });
  });

  it("throws TwentyApiError (not SyntaxError) on a non-2xx, non-JSON body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("<html>Internal Server Error</html>", { status: 502 }));
    const client = new GraphQLClient(cfg, fetchImpl as unknown as typeof fetch);
    await expect(client.request("q", {})).rejects.toMatchObject({
      status: 502,
      body: "<html>Internal Server Error</html>",
    });
  });
});
