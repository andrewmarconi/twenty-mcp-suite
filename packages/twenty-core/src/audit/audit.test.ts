import { describe, it, expect } from "vitest";
import { z } from "zod";
import { auditWrap, withAudit } from "./audit.js";
import type { AuditEntry } from "./audit.js";
import type { ToolDef } from "../tools/schemaTools.js";

function clock(times: number[]): () => number {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
}

describe("auditWrap", () => {
  it("emits an ok entry with duration on success and returns the result", async () => {
    const entries: AuditEntry[] = [];
    const wrapped = auditWrap(
      async () => "result",
      { tool: "find_contacts", connection: "acme", env: "prod" },
      (e) => entries.push(e),
      clock([1000, 1025]),
    );
    expect(await wrapped({})).toBe("result");
    expect(entries).toEqual([
      { tool: "find_contacts", connection: "acme", env: "prod", outcome: "ok", ms: 25 },
    ]);
  });

  it("emits an error entry (with the message, not args) and rethrows", async () => {
    const entries: AuditEntry[] = [];
    const wrapped = auditWrap(
      async () => {
        throw new Error("boom");
      },
      { tool: "delete_records", connection: "acme" },
      (e) => entries.push(e),
      clock([0, 10]),
    );
    await expect(wrapped({ secret: "x" })).rejects.toThrow("boom");
    expect(entries[0]).toEqual({
      tool: "delete_records",
      connection: "acme",
      env: undefined,
      outcome: "error",
      ms: 10,
      error: "boom",
    });
    // the audit entry must not carry the args:
    expect(JSON.stringify(entries[0])).not.toContain("secret");
  });
});

describe("withAudit", () => {
  it("wraps every tool's handler and preserves name/description/schema", async () => {
    const entries: AuditEntry[] = [];
    const tools: ToolDef[] = [
      { name: "t1", description: "d1", inputSchema: z.object({}), handler: async () => "a" },
      { name: "t2", description: "d2", inputSchema: z.object({}), handler: async () => "b" },
    ];
    const wrapped = withAudit(tools, { connection: "acme" }, (e) => entries.push(e));
    expect(wrapped.map((t) => t.name)).toEqual(["t1", "t2"]);
    expect(wrapped[0].description).toBe("d1");
    await wrapped[0].handler({});
    await wrapped[1].handler({});
    expect(entries.map((e) => e.tool)).toEqual(["t1", "t2"]);
  });
});
