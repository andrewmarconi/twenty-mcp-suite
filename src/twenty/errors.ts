export class TwentyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly url: string,
  ) {
    super(message);
    this.name = "TwentyApiError";
  }
}

const DRIFT_PATTERNS = [
  /does not exist/i,
  /unknown (field|column|object)/i,
  /no such (field|column|object)/i,
  /cannot find object/i,
];

export function isSchemaDriftError(status: number, body: unknown): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  const text = JSON.stringify(body ?? "");
  return DRIFT_PATTERNS.some((p) => p.test(text));
}

export function driftHint(objectName: string): string {
  return (
    ` This may mean the schema for "${objectName}" changed in Twenty. ` +
    `Call refresh_schema to reload the live schema, then retry.`
  );
}
