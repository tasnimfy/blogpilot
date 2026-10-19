import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: {
    // Automatic JSX runtime for TSX test files (matches Next's tsconfig).
    jsx: "automatic",
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/setup/global.ts"],
    setupFiles: ["./tests/setup/env.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    fileParallelism: false,
    hookTimeout: 60000,
    testTimeout: 30000,
  },
});
