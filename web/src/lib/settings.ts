// 設定 (P2.7 §5.8)。ローカル保存。

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

export function loadSettings(): Settings {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return { ...DEFAULT_SETTINGS, ...(JSON.parse(s) as Partial<Settings>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED) === "1";
  } catch {
    return true; // localStorage 不可なら初回演出を強制しない
  }
}

export function setOnboarded(v: boolean): void {
  try {
    if (v) localStorage.setItem(ONBOARDED, "1");
    else localStorage.removeItem(ONBOARDED);
  } catch {
    /* ignore */
  }
}
