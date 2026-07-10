import { Capacitor } from "@capacitor/core";

// ネイティブ(Capacitor)判定 (P6 土台)。web / SSR / テストでは安全に false / "web"。
export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function currentPlatform(): "ios" | "android" | "web" {
  try {
    return Capacitor.getPlatform() as "ios" | "android" | "web";
  } catch {
    return "web";
  }
}
