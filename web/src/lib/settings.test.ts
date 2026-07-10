import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  isOnboarded,
  loadSettings,
  saveSettings,
  setOnboarded,
} from "./settings";

// Node 環境には localStorage が無いため最小スタブを注入する。
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
    new MemoryStorage();
});

describe("settings", () => {
  it("未保存時は既定値", async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("save→load でラウンドトリップ", async () => {
    await saveSettings({ motion: "reduce", core: "always", detail: "detailed" });
    expect(await loadSettings()).toEqual({ motion: "reduce", core: "always", detail: "detailed" });
  });

  it("部分的な保存値は既定でマージされる", async () => {
    localStorage.setItem("octobrain.settings", JSON.stringify({ motion: "normal" }));
    expect(await loadSettings()).toEqual({ ...DEFAULT_SETTINGS, motion: "normal" });
  });

  it("壊れた JSON は既定へフォールバック", async () => {
    localStorage.setItem("octobrain.settings", "{not json");
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("onboarded flag", () => {
  it("既定は未完了(=false)", async () => {
    expect(await isOnboarded()).toBe(false);
  });

  it("set(true)/set(false) を反映", async () => {
    await setOnboarded(true);
    expect(await isOnboarded()).toBe(true);
    await setOnboarded(false);
    expect(await isOnboarded()).toBe(false);
  });
});
