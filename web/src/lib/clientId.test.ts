import { beforeEach, describe, expect, it } from "vitest";
import { loadOrCreateClientId } from "./clientId";

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

describe("loadOrCreateClientId", () => {
  it("初回は発行して永続化し、再読込で同じ値", async () => {
    const a = await loadOrCreateClientId();
    expect(a.length).toBeGreaterThan(8);
    const b = await loadOrCreateClientId();
    expect(b).toBe(a);
    expect(localStorage.getItem("octobrain.clientId")).toBe(a);
  });

  it("既存値があればそれを使う", async () => {
    localStorage.setItem("octobrain.clientId", "stable-client-1");
    expect(await loadOrCreateClientId()).toBe("stable-client-1");
  });
});
