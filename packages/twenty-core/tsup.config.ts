import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  // Workaround for egoist/tsup#1388: tsup's DTS pass injects an implicit
  // `baseUrl`, which TypeScript 6 flags as the deprecated TS5101. Scope the
  // opt-out to the declaration-emit compiler pass only — the standalone
  // `typecheck` script (plain `tsc --noEmit`) still runs full, unrelaxed
  // type-checking. Remove once tsup ships the fix.
  dts: {
    compilerOptions: {
      ignoreDeprecations: "6.0",
    },
  },
  clean: true,
});
