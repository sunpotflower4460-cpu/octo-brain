import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Capacitor互換: base は相対パス './'、環境変数は VITE_ プレフィックスのみ (VITE_API_BASE)
export default defineConfig({
  base: "./",
  plugins: [react()],
});
