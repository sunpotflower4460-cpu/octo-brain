import { beforeEach, describe, expect, it } from "vitest";
import { CONSENT_VERSION, hasAiConsent, setAiConsent } from "./consent";

// web 版の kv は localStorage。vitest(node) 用に最小の Storage を用意する。
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

describe("AI 送信同意", () => {
  it("初期状態は未同意", async () => {
    expect(await hasAiConsent()).toBe(false);
  });
  it("同意→撤回", async () => {
    await setAiConsent(true);
    expect(await hasAiConsent()).toBe(true);
    await setAiConsent(false);
    expect(await hasAiConsent()).toBe(false);
  });
  it("古い版の同意は無効(送信先の変更時に再同意させる)", async () => {
    localStorage.setItem("octobrain.aiConsent", "2000-01-01");
    expect(await hasAiConsent()).toBe(false);
    expect(CONSENT_VERSION).not.toBe("2000-01-01");
  });
});
