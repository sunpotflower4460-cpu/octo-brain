import { defineConfig } from "vitest/config";

export default defineConfig({
  // wrangler の Text ルールと同じく .md を文字列モジュールとして読む(法務文書ページ用)
  plugins: [
    {
      name: "md-as-text",
      transform(code, id) {
        if (id.endsWith(".md")) return { code: `export default ${JSON.stringify(code)};`, map: null };
        return null;
      },
    },
  ],
  test: {
    // callModel は global fetch/Response/AbortController のみに依存し、
    // fetch はモックするため Node 環境で十分 (workerd 不要)。
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
  },
});
