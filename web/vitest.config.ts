import { defineConfig } from "vitest/config";

// ユニットテスト用の設定。テスト対象 (sse.ts / phase.ts) は素のTSで
// JSX/DOM を使わないため Node 環境で十分。react プラグインは不要。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
