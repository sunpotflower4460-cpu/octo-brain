import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Capacitor互換: base は相対パス './'、環境変数は VITE_ プレフィックスのみ (VITE_API_BASE)
export default defineConfig(({ command, mode }) => {
  // 本番ビルドで API の URL が未設定・プレースホルダー・非 https のまま
  // アプリを出荷しない(全リクエストが失敗するアプリになるため)。
  if (command === "build" && mode === "production") {
    const base = loadEnv(mode, process.cwd(), "VITE_").VITE_API_BASE ?? "";
    if (!/^https:\/\//.test(base) || base.includes("SET_ME")) {
      throw new Error(
        `VITE_API_BASE が本番用に設定されていません (${base || "未設定"})。web/.env.production を確認してください。`,
      );
    }
  }
  return {
    base: "./",
    plugins: [react()],
  };
});
