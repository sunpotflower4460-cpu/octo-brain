import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor 6 設定 (P6 土台)。実機プロジェクト生成(ios/android)は P7 で行う。
// webDir は Vite の本番ビルド出力。色は深海テーマ(tokens.css の --bg-abyss)に合わせる。
const config: CapacitorConfig = {
  appId: "com.octobrain.app",
  appName: "OctoBrain",
  webDir: "dist",
  backgroundColor: "#050711",
  ios: {
    // ノッチ端末で自前の env(safe-area-inset-*) を効かせるため never。
    contentInset: "never",
    backgroundColor: "#050711",
  },
  android: {
    backgroundColor: "#050711",
  },
  plugins: {
    SplashScreen: {
      backgroundColor: "#050711",
      showSpinner: false,
      launchAutoHide: false, // JS 初期化後に手動 hide()(shell.ts)
    },
    Keyboard: {
      resize: "native",
    },
    StatusBar: {
      style: "LIGHT", // 暗い背景 → 明るい文字
      backgroundColor: "#050711",
    },
  },
};

export default config;
