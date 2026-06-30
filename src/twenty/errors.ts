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
  // Scoped to schema-element keywords so data-validation 400s (e.g. a missing
  // *record*: 'Related Company with id "abc" does not exist') aren't
  // misrouted to refresh_schema. Confirm Twenty's exact schema-drift 400
  // wording against a live instance (Task 13) and tighten/loosen as needed.
  /(field|column|object|property|relation)[^.]*does not exist/i,
  /unknown (field|column|object)/i,
  /no such (field|column|object)/i,
  /cannot find object/i,
];

export function isSchemaDriftError(status: number, body: unknown): boolean {
  // 404 is treated the same as 400: it is schema drift ONLY if the body
  // matches DRIFT_PATTERNS (e.g. "cannot find object", "object ... does not
  // exist"). A bare/record-not-found 404 (e.g. get_record/update_records/
  // delete_records with a stale id, "Could not find Person with id ...") is
  // NOT drift and must fall through as an ordinary error, otherwise the
  // model gets told to call refresh_schema and loops on a retry that can
  // never succeed. The exact Twenty 404 drift wording is unverified against
  // a live instance (provisional, like search/upsert) — DRIFT_PATTERNS may
  // need tuning once the integration suite lands (Task 13).
  if (status !== 400 && status !== 404) return false;
  const text = JSON.stringify(body ?? "");
  return DRIFT_PATTERNS.some((p) => p.test(text));
}

export function driftHint(objectName: string): string {
  return (
    ` This may mean the schema for "${objectName}" changed in Twenty. ` +
    `Call refresh_schema to reload the live schema, then retry.`
  );
}
