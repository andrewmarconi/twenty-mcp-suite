import { TwentyApiError, isSchemaDriftError, driftHint } from "../twenty/errors.js";

export async function withDriftHandling<T>(object: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TwentyApiError && isSchemaDriftError(err.status, err.body)) {
      throw new Error(`${err.message}.${driftHint(object)}`);
    }
    throw err;
  }
}
