import { currentPlatform, isNativePlatform } from "./platform";

// ネイティブシェルの初期化 (P6 土台)。web では何もしない(no-op)。
// StatusBar の文字色・SplashScreen の解除・キーボードのレイアウト方式を整える。
// プラグインは動的 import なので web バンドルの実行時には読み込まれない。
export async function initNativeShell(): Promise<void> {
  if (!isNativePlatform()) return;

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    // 暗い背景 → 明るい文字
    await StatusBar.setStyle({ style: Style.Light });
    if (currentPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: "#050711" });
    }
  } catch {
    /* StatusBar 非対応 */
  }

  try {
    const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
    // キーボード出現時に WebView 自体をリサイズ → 入力フッターが隠れない
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
  } catch {
    /* Keyboard 非対応 */
  }

  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    /* SplashScreen 非対応 */
  }
}
