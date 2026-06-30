import { describe, it, expect } from "vitest";
import {
  TwentyApiError,
  isSchemaDriftError,
  driftHint,
} from "./errors.js";

describe("TwentyApiError", () => {
  it("carries status, body, and url", () => {
    const e = new TwentyApiError("boom", 404, { messages: ["not found"] }, "/rest/widgets");
    expect(e.status).toBe(404);
    expect(e.url).toBe("/rest/widgets");
    expect(e.body).toEqual({ messages: ["not found"] });
  });
});

describe("isSchemaDriftError", () => {
  it("treats 404 as drift", () => {
    expect(isSchemaDriftError(404, {})).toBe(true);
  });

  it("treats a 400 mentioning an unknown field as drift", () => {
    expect(
      isSchemaDriftError(400, { messages: ['Field "foo" does not exist on object'] }),
    ).toBe(true);
  });

  it("does not treat a generic 400 as drift", () => {
    expect(isSchemaDriftError(400, { messages: ["value too long"] })).toBe(false);
  });

  it("does not treat a missing-record 400 as drift", () => {
    expect(
      isSchemaDriftError(400, {
        messages: ['Related Company with id "abc" does not exist'],
      }),
    ).toBe(false);
  });

  it("does not treat 401 as drift", () => {
    expect(isSchemaDriftError(401, {})).toBe(false);
  });
});

describe("driftHint", () => {
  it("names refresh_schema and the object", () => {
    expect(driftHint("widgets")).toMatch(/refresh_schema/);
    expect(driftHint("widgets")).toMatch(/widgets/);
  });
});
