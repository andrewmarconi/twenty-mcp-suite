import { z } from "zod";
import type { SchemaCache } from "../schema/cache.js";
import type { ObjectSchema } from "../schema/types.js";
import type { ToolDef } from "../tools/schemaTools.js";
import type { CapabilityProfile, ProfileToolSpec } from "./types.js";

function normalizeScope(scope?: string[]): Set<string> | null {
  return scope ? new Set(scope.map((s) => s.toLowerCase())) : null;
}

function inScope(scopeSet: Set<string>, schema: ObjectSchema): boolean {
  return (
    scopeSet.has(schema.namePlural.toLowerCase()) || scopeSet.has(schema.nameSingular.toLowerCase())
  );
}

export function buildProfileTools(
  profile: CapabilityProfile,
  primitives: ToolDef[],
  cache: SchemaCache,
): ToolDef[] {
  const byName = new Map(primitives.map((t) => [t.name, t]));
  const scopeSet = normalizeScope(profile.objectScope);
  const out: ToolDef[] = [];
  const seen = new Set<string>();

  for (const spec of profile.tools) {
    const base = byName.get(spec.from);
    if (!base) {
      throw new Error(`Profile "${profile.name}" references unknown tool "${spec.from}".`);
    }
    const name = spec.as ?? spec.from;
    if (seen.has(name)) {
      throw new Error(`Profile "${profile.name}" exposes duplicate tool name "${name}".`);
    }
    seen.add(name);

    let inputSchema = base.inputSchema;
    if (spec.bind && Object.keys(spec.bind).length > 0) {
      if (!(inputSchema instanceof z.ZodObject)) {
        throw new Error(
          `Profile "${profile.name}" binds args on "${spec.from}", but its input schema is not an object.`,
        );
      }
      const mask = Object.fromEntries(Object.keys(spec.bind).map((k) => [k, true as const]));
      inputSchema = (inputSchema as z.ZodObject<z.ZodRawShape>).omit(mask);
    }

    out.push({
      name,
      description: spec.description ?? base.description,
      inputSchema,
      handler: makeHandler(base, spec, profile.name, scopeSet, cache),
    });
  }
  return out;
}

function makeHandler(
  base: ToolDef,
  spec: ProfileToolSpec,
  profileName: string,
  scopeSet: Set<string> | null,
  cache: SchemaCache,
): (args: unknown) => Promise<string> {
  return async (args: unknown) => {
    const merged =
      spec.bind && typeof args === "object" && args !== null
        ? { ...(args as Record<string, unknown>), ...spec.bind }
        : (spec.bind ?? args);

    if (scopeSet) {
      const object = (merged as { object?: unknown }).object;
      if (typeof object === "string") {
        await cache.ensureLoaded();
        const schema = cache.resolve(object); // throws on a truly-unknown object
        if (!inScope(scopeSet, schema)) {
          throw new Error(`Object "${object}" is not available in the "${profileName}" profile.`);
        }
      }
      if (spec.from === "list_object_types") {
        return filterListToScope(await base.handler(merged), scopeSet);
      }
    }
    return base.handler(merged);
  };
}

function filterListToScope(text: string, scopeSet: Set<string>): string {
  const list = JSON.parse(text) as Array<{ nameSingular: string; namePlural: string }>;
  return JSON.stringify(
    list.filter(
      (o) => scopeSet.has(o.namePlural.toLowerCase()) || scopeSet.has(o.nameSingular.toLowerCase()),
    ),
  );
}
