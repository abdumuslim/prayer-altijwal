// Client tests cover the pure lib/ modules only (worship log, day math,
// storage coercion) — node environment, no DOM/jsdom: hooks stay thin shells
// over these tested functions. Mirrors the server's src-only include so a
// stray build never runs compiled copies twice.

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    environment: "node",
  },
});
