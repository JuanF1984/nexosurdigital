import { defineConfig } from "vitest/config";
import path from "node:path";

// Mirrors the "@/*" -> "./src/*" alias from tsconfig.json so tests can
// import modules the same way application code does.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
  },
});
