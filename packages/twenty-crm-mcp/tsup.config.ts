import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli-bin.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});
