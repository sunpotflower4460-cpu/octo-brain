import { isNativePlatform } from "./platform";

// 小さなKV永続化 (P6 土台)。ネイティブは Capacitor Preferences、web は localStorage。
// 設定・オンボーディング等の軽い値に使う(会話本体は容量の大きい IndexedDB のまま)。
// Preferences はアプリ更新をまたいで残り、iOS では内部的に UserDefaults を使う。
export const kv = {
  async get(key: string): Promise<string | null> {
    if (isNativePlatform()) {
      try {
        const { Preferences } = await import("@capacitor/preferences");
        const { value } = await Preferences.get({ key });
        return value ?? null;
      } catch {
        return null;
      }
    }
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  async set(key: string, value: string): Promise<void> {
    if (isNativePlatform()) {
      try {
        const { Preferences } = await import("@capacitor/preferences");
        await Preferences.set({ key, value });
      } catch {
        /* 保存失敗は非致命 */
      }
      return;
    }
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 非致命 */
    }
  },

  async remove(key: string): Promise<void> {
    if (isNativePlatform()) {
      try {
        const { Preferences } = await import("@capacitor/preferences");
        await Preferences.remove({ key });
      } catch {
        /* 非致命 */
      }
      return;
    }
    try {
      localStorage.removeItem(key);
    } catch {
      /* 非致命 */
    }
  },
};
