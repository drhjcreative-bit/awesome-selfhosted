import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The React plugin gives test files the automatic JSX runtime (so .jsx sources
// and tests compile without importing React). The default environment is "node"
// because the pure-helper suites in src/lib/ need no DOM; component/integration
// suites opt into jsdom per-file with a `// @vitest-environment jsdom` docblock.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{js,jsx}"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.js", "src/App.jsx"],
      reporter: ["text", "html"],
    },
  },
});
