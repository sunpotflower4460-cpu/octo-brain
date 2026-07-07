import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // callModel は global fetch/Response/AbortController のみに依存し、
    // fetch はモックするため Node 環境で十分 (workerd 不要)。
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
