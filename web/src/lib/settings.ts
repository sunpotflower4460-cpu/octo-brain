// 設定 (P2.7 §5.8 / P6 で永続化を Preferences ベースの KV へ)。
// web は localStorage、ネイティブは Capacitor Preferences(kv 抽象が吸収)。

import { kv } from "./native/kv";

export type MotionSetting = "system" | "reduce" | "normal";
export type CoreSetting = "auto" | "always";
export type DetailSetting = "standard" | "detailed";

export interface Settings {
  motion: MotionSetting;
  core: CoreSetting;
  detail: DetailSetting;
}

export const DEFAULT_SETTINGS: Settings = {
  motion: "system",
  core: "auto",
  detail: "standard",
};

const KEY = "octobrain.settings";
const ONBOARDED = "octobrain.onboarded";

export async function loadSettings(): Promise<Settings> {
  const s = await kv.get(KEY);
  if (s) {
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(s) as Partial<Settings>) };
    } catch {
      /* 壊れた値は既定へ */
    }
  }
  return DEFAULT_SETTINGS;
}

export async function saveSettings(s: Settings): Promise<void> {
  await kv.set(KEY, JSON.stringify(s));
}

export async function isOnboarded(): Promise<boolean> {
  return (await kv.get(ONBOARDED)) === "1";
}

export async function setOnboarded(v: boolean): Promise<void> {
  if (v) await kv.set(ONBOARDED, "1");
  else await kv.remove(ONBOARDED);
}
