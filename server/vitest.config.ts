import { defineConfig } from "vitest/config";

// Tests run from src only. Without an explicit include, vitest's default glob
// also picks up compiled dist/*.test.js from a local `npm run build`, running
// every suite twice (the second copy frozen at build time).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The verbatim engine copy + calibrate are dev/one-off; never run them as
    // app tests beyond the ported regression suite (which is *.test.ts).
    exclude: ["node_modules", "dist", "src/prayer-engine/calibrate.ts"],
  },
});
