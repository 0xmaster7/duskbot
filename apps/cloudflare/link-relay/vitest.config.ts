import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: { include: ["test/**/*.test.js"], environment: "node", testTimeout: 120_000, hookTimeout: 120_000 },
});
