import { describe, it, expect, vi } from "vitest";
import { SchemaCache } from "./cache.js";
import type { ObjectSchema } from "./types.js";

const people: ObjectSchema = {
  nameSingular: "person", namePlural: "people",
  labelSingular: "Person", labelPlural: "People",
  isActive: true, isSystem: false, isSearchable: true,
  fields: [{ name: "name", type: "TEXT", isNullable: false, isUnique: false, isActive: true, isSystem: false }],
};

describe("SchemaCache", () => {
  it("loads lazily exactly once across concurrent ensureLoaded calls", async () => {
    const loader = vi.fn().mockResolvedValue([people]);
    const cache = new SchemaCache({} as any, loader);
    await Promise.all([cache.ensureLoaded(), cache.ensureLoaded()]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("resolves by plural or singular, case-insensitively", async () => {
    const cache = new SchemaCache({} as any, vi.fn().mockResolvedValue([people]));
    await cache.ensureLoaded();
    expect(cache.resolve("People").namePlural).toBe("people");
    expect(cache.resolve("person").namePlural).toBe("people");
  });

  it("throws a refresh_schema hint when object is unknown", async () => {
    const cache = new SchemaCache({} as any, vi.fn().mockResolvedValue([people]));
    await cache.ensureLoaded();
    expect(() => cache.resolve("widgets")).toThrow(/refresh_schema/);
  });

  it("refresh reloads and returns the count", async () => {
    const loader = vi.fn().mockResolvedValue([people]);
    const cache = new SchemaCache({} as any, loader);
    await cache.ensureLoaded();
    const n = await cache.refresh();
    expect(n).toBe(1);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
