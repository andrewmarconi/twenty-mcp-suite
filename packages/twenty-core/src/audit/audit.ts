import type { ToolDef } from "../tools/schemaTools.js";

export interface AuditEntry {
  tool: string;
  connection: string;
  env?: string;
  outcome: "ok" | "error";
  ms: number;
  error?: string;
}

export type AuditSink = (entry: AuditEntry) => void;

/** Default sink: one structured JSON line per tool call, on stderr (never stdout). */
export const stderrAuditSink: AuditSink = (entry) => {
  console.error(JSON.stringify({ audit: entry }));
};

export function auditWrap(
  handler: (args: unknown) => Promise<string>,
  meta: { tool: string; connection: string; env?: string },
  sink: AuditSink,
  now: () => number = () => Date.now(),
): (args: unknown) => Promise<string> {
  return async (args: unknown) => {
    const start = now();
    try {
      const result = await handler(args);
      sink({
        tool: meta.tool,
        connection: meta.connection,
        env: meta.env,
        outcome: "ok",
        ms: now() - start,
      });
      return result;
    } catch (err) {
      sink({
        tool: meta.tool,
        connection: meta.connection,
        env: meta.env,
        outcome: "error",
        ms: now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}

export function withAudit(
  tools: ToolDef[],
  meta: { connection: string; env?: string },
  sink: AuditSink = stderrAuditSink,
): ToolDef[] {
  return tools.map((t) => ({
    ...t,
    handler: auditWrap(
      t.handler,
      { tool: t.name, connection: meta.connection, env: meta.env },
      sink,
    ),
  }));
}
