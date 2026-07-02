import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "twenty-core": fileURLToPath(new URL("../twenty-core/src/index.ts", import.meta.url)),
    },
  },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
