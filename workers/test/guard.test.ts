import { describe, expect, it } from "vitest";
import {
  acquireSlot,
  releaseSlot,
  checkQuota,
  quotaLimit,
  requestBudgetMs,
  numEnv,
  DEFAULT_FREE_MONTHLY_QUOTA,
  DEFAULT_REQUEST_BUDGET_MS,
} from "../src/lib/guard.js";
import { quotaKey } from "../src/lib/costlog.js";
import type { Env } from "../src/types.js";

function makeKV(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

const NOW = new Date("2026-07-14T00:00:00Z");
const OPTS = { minIntervalMs: 1500, lockMs: 40_000 };

describe("checkQuota", () => {
  it("上限未満は allowed", async () => {
    const { kv, store } = makeKV();
    store.set(quotaKey("c1", NOW), "50");
    const q = await checkQuota(kv, "c1", NOW, 100);
    expect(q).toEqual({ used: 50, limit: 100, allowed: true });
  });

  it("上限到達で block", async () => {
    const { kv, store } = makeKV();
    store.set(quotaKey("c1", NOW), "100");
    const q = await checkQuota(kv, "c1", NOW, 100);
    expect(q.allowed).toBe(false);
  });

  it("未使用は used=0 で allowed", async () => {
    const { kv } = makeKV();
    const q = await checkQuota(kv, "new", NOW, 100);
    expect(q).toEqual({ used: 0, limit: 100, allowed: true });
  });

  it("KV読み取り失敗は安全側(ブロックしない)", async () => {
    const kv = {
      get: async () => {
        throw new Error("kv down");
      },
      put: async () => {},
    } as unknown as KVNamespace;
    const q = await checkQuota(kv, "c1", NOW, 100);
    expect(q.allowed).toBe(true);
    expect(q.used).toBe(0);
  });
});

describe("acquireSlot / releaseSlot", () => {
  it("初回は取得できる", async () => {
    const { kv } = makeKV();
    const r = await acquireSlot(kv, "c1", 1000, OPTS);
    expect(r.ok).toBe(true);
  });

  it("処理中の同時実行は in_progress で弾く", async () => {
    const { kv } = makeKV();
    await acquireSlot(kv, "c1", 1000, OPTS); // inFlight=true, lockUntil=41000
    const r = await acquireSlot(kv, "c1", 1100, OPTS);
    expect(r).toEqual({ ok: false, error: "in_progress", retryAfterMs: 39900 });
  });

  it("解放後でも最小間隔未満は too_frequent", async () => {
    const { kv } = makeKV();
    await acquireSlot(kv, "c1", 1000, OPTS);
    await releaseSlot(kv, "c1", 1050);
    const r = await acquireSlot(kv, "c1", 1200, OPTS); // since=200 < 1500
    expect(r).toEqual({ ok: false, error: "too_frequent", retryAfterMs: 1300 });
  });

  it("解放後に間隔を空ければ再取得できる", async () => {
    const { kv } = makeKV();
    await acquireSlot(kv, "c1", 1000, OPTS);
    await releaseSlot(kv, "c1", 1050);
    const r = await acquireSlot(kv, "c1", 3000, OPTS); // since=2000 >= 1500
    expect(r.ok).toBe(true);
  });

  it("異常終了(未解放)でも lock 期限後は自己回復する", async () => {
    const { kv } = makeKV();
    await acquireSlot(kv, "c1", 1000, OPTS); // lockUntil=41000, last=1000
    const r = await acquireSlot(kv, "c1", 41001, OPTS); // now>=lockUntil, since大
    expect(r.ok).toBe(true);
  });

  it("clientId ごとに独立", async () => {
    const { kv } = makeKV();
    await acquireSlot(kv, "a", 1000, OPTS);
    const r = await acquireSlot(kv, "b", 1000, OPTS);
    expect(r.ok).toBe(true);
  });
});

describe("env ヘルパー", () => {
  const base = { OCTO_KV: {} as KVNamespace } as Env;
  it("numEnv は未設定/不正で既定へ", () => {
    expect(numEnv(base, "X", 7)).toBe(7);
    expect(numEnv({ ...base, X: "abc" }, "X", 7)).toBe(7);
    expect(numEnv({ ...base, X: "0" }, "X", 7)).toBe(7); // 0 以下は不採用
    expect(numEnv({ ...base, X: "42" }, "X", 7)).toBe(42);
  });
  it("quotaLimit / requestBudgetMs は既定を持つ", () => {
    expect(quotaLimit(base)).toBe(DEFAULT_FREE_MONTHLY_QUOTA);
    expect(requestBudgetMs(base)).toBe(DEFAULT_REQUEST_BUDGET_MS);
    expect(quotaLimit({ ...base, FREE_MONTHLY_QUOTA: "5" })).toBe(5);
  });
});
