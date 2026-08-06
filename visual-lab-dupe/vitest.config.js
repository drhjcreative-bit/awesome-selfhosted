import { defineConfig } from "vitest/config";

// Test config is kept separate from vite.config.js so the app build doesn't
// pull in the React plugin's test-only transforms. The current suite covers the
// pure helpers in src/lib/, which need no DOM, so the default environment is
// "node". Component/integration groups can opt into jsdom per-file with a
// `// @vitest-environment jsdom` docblock.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{js,jsx}"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.js"],
      reporter: ["text", "html"],
    },
  },
});
