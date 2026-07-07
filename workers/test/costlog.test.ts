import { describe, expect, it } from "vitest";
import {
  CostCollector,
  incrementQuota,
  logCost,
  type StoredCostRecord,
} from "../src/lib/costlog.js";
import type { CostCallRecord } from "../src/types.js";

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

function rec(estCost: number): CostCallRecord {
  return {
    role: "node",
    model: "m",
    inTok: 100,
    outTok: 50,
    estCost,
    ms: 10,
    estimated: false,
  };
}

const NOW = new Date("2026-07-07T12:00:00Z");

describe("CostCollector 集約", () => {
  it("呼び出し数と合計コストを集約する", () => {
    const c = new CostCollector();
    c.record(rec(0.001));
    c.record(rec(0.002));
    c.record(rec(0.0005));
    expect(c.calls).toHaveLength(3);
    expect(c.totalCost()).toBeCloseTo(0.0035, 10);
  });
});

describe("logCost", () => {
  it("cost:{yyyymmdd}:{requestId} に全callレコードと合計を保存する", async () => {
    const { kv, store } = makeKV();
    const c = new CostCollector();
    c.record(rec(0.001));
    c.record(rec(0.002));

    await logCost(kv, "req-123", c, { quorum: "6/8", fallback: false }, NOW);

    const raw = store.get("cost:20260707:req-123");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as StoredCostRecord;
    expect(parsed.calls).toHaveLength(2);
    expect(parsed.totalCost).toBeCloseTo(0.003, 10);
    expect(parsed.quorum).toBe("6/8");
    expect(parsed.fallback).toBe(false);
  });
});

describe("incrementQuota", () => {
  it("quota:{clientId}:{yyyymm} をインクリメントする", async () => {
    const { kv, store } = makeKV();
    const first = await incrementQuota(kv, "client-a", NOW);
    const second = await incrementQuota(kv, "client-a", NOW);
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(store.get("quota:client-a:202607")).toBe("2");
  });

  it("clientId ごとに独立してカウントする", async () => {
    const { kv } = makeKV();
    await incrementQuota(kv, "client-a", NOW);
    const b = await incrementQuota(kv, "client-b", NOW);
    expect(b).toBe(1);
  });
});
