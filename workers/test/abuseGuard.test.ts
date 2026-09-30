import { describe, expect, it } from "vitest";
import app from "../src/index.js";
import { quotaKey } from "../src/lib/costlog.js";
import {
  checkQuota,
  consumeIpQuota,
  ipQuotaKey,
  isValidClientId,
  QUOTA_UNITS,
} from "../src/lib/guard.js";

// 監査 C2/C3: 無料枠の迂回を塞ぐガード。
// いずれのケースもパイプライン到達前に弾くため、実モデル/APIキー不要。

// KV 実機と同じく 512B 超のキーで例外を投げるモック(旧実装はこれで素通りした)
function kvMock(seed: Record<string, string> = {}): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(seed));
  const check = (k: string) => {
    if (new TextEncoder().encode(k).length > 512) throw new Error("414 key too long");
  };
  const kv = {
    get: async (k: string) => {
      check(k);
      return store.get(k) ?? null;
    },
    put: async (k: string, v: string) => {
      check(k);
      store.set(k, v);
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

function req(path: string, body: unknown, ip?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ip) headers["CF-Connecting-IP"] = ip;
  return new Request(`http://x${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("isValidClientId", () => {
  it("UUID と英数・-_ の64字以内を受理", () => {
    expect(isValidClientId("5f0c6f1e-6a8b-4c3e-9d2a-1b2c3d4e5f60")).toBe(true);
    expect(isValidClientId("c-abc123-1790000000000")).toBe(true);
  });
  it("長すぎ・記号・空・非文字列は拒否", () => {
    expect(isValidClientId("x".repeat(65))).toBe(false);
    expect(isValidClientId("../quota:victim")).toBe(false);
    expect(isValidClientId("a b")).toBe(false);
    expect(isValidClientId("")).toBe(false);
    expect(isValidClientId(123)).toBe(false);
  });
});

describe("不正 clientId はガード前に 400(KV 例外による素通りを防ぐ)", () => {
  const long = "y".repeat(600);
  it("analyze", async () => {
    const { kv } = kvMock();
    const res = await app.request(req("/api/analyze", { input: "a", clientId: long }), {}, { OCTO_KV: kv });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_clientId");
  });
  it("analyze/stream", async () => {
    const { kv } = kvMock();
    const res = await app.request(
      req("/api/analyze/stream", { input: "a", clientId: long }),
      {},
      { OCTO_KV: kv },
    );
    expect(res.status).toBe(400);
  });
  it("deepen", async () => {
    const { kv } = kvMock();
    const res = await app.request(
      req("/api/deepen", { input: "a", clientId: long, tension: { axis: "時の軸" } }),
      {},
      { OCTO_KV: kv },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_clientId");
  });
  it("resonate", async () => {
    const { kv } = kvMock();
    const res = await app.request(
      req("/api/resonate", {
        input: "a",
        clientId: long,
        resonance: { a: { lens: "risk", claim: "x" }, b: { lens: "values", claim: "y" } },
      }),
      {},
      { OCTO_KV: kv },
    );
    expect(res.status).toBe(400);
  });
});

describe("クォータの消費単位", () => {
  it("deep と深化は2単位、light と共鳴は1単位", () => {
    expect(QUOTA_UNITS).toEqual({ light: 1, deep: 2, deepen: 2, resonate: 1 });
  });
  it("残り1単位では deep(2単位)を通さず light は通す", async () => {
    const now = new Date();
    const { kv } = kvMock({ [quotaKey("c1", now)]: "99" });
    expect((await checkQuota(kv, "c1", now, 100, 2)).allowed).toBe(false);
    expect((await checkQuota(kv, "c1", now, 100, 1)).allowed).toBe(true);
  });
  it("残り1で deep を送ると 429 quota_exceeded(units 付き)", async () => {
    const { kv } = kvMock({ [quotaKey("c-deep", new Date())]: "99" });
    const res = await app.request(
      req("/api/analyze", { input: "a", clientId: "c-deep", plan: "deep" }),
      {},
      { OCTO_KV: kv },
    );
    expect(res.status).toBe(429);
    const j = (await res.json()) as { error: string; units: number; used: number };
    expect(j.error).toBe("quota_exceeded");
    expect(j.units).toBe(2);
    expect(j.used).toBe(99);
  });
});

describe("deep プランの提供フラグ", () => {
  it("DEEP_PLAN_ENABLED=false なら deep は 403 plan_not_available", async () => {
    const { kv } = kvMock();
    const res = await app.request(
      req("/api/analyze", { input: "a", clientId: "c-flag", plan: "deep" }),
      {},
      { OCTO_KV: kv, DEEP_PLAN_ENABLED: "false" },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("plan_not_available");
  });
});

describe("IP 単位の制限(clientId 使い捨て対策)", () => {
  it("Rate Limiting バインディングが拒否したら 429 ip_rate_limited", async () => {
    const { kv } = kvMock();
    const limiter = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    const res = await app.request(
      req("/api/analyze", { input: "a", clientId: "c-ip1" }, "203.0.113.5"),
      {},
      { OCTO_KV: kv, IP_RATE_LIMITER: limiter },
    );
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("ip_rate_limited");
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("IP の1日上限到達なら clientId を変えても 429 ip_quota_exceeded", async () => {
    const ip = "203.0.113.9";
    const { kv, store } = kvMock({ [ipQuotaKey(ip, new Date())]: "300" });
    const res = await app.request(
      req("/api/analyze", { input: "a", clientId: "fresh-id-1" }, ip),
      {},
      { OCTO_KV: kv },
    );
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("ip_quota_exceeded");
    // ブロック時は同時実行ロックを解放している
    expect(JSON.parse(store.get("rl:fresh-id-1") ?? "{}").inFlight).toBe(false);
  });

  it("consumeIpQuota は受理時に units を加算する", async () => {
    const now = new Date();
    const { kv, store } = kvMock();
    const r1 = await consumeIpQuota(kv, "198.51.100.1", now, 2, 3);
    expect(r1).toMatchObject({ allowed: true, used: 2 });
    const r2 = await consumeIpQuota(kv, "198.51.100.1", now, 1, 3);
    expect(r2).toMatchObject({ allowed: true, used: 3 });
    const r3 = await consumeIpQuota(kv, "198.51.100.1", now, 1, 3);
    expect(r3.allowed).toBe(false);
    expect(store.get(ipQuotaKey("198.51.100.1", now))).toBe("3");
  });
});

describe("全体の1日予算(課金なし運用のサーキットブレーカー)", () => {
  it("当日の原価が DAILY_BUDGET_USD に達していたら 503 daily_budget_exceeded", async () => {
    const { spendKey } = await import("../src/lib/costlog.js");
    const { kv } = kvMock({ [spendKey(new Date())]: String(3_000_000) }); // $3.00
    const res = await app.request(
      req("/api/analyze", { input: "a", clientId: "c-budget" }),
      {},
      { OCTO_KV: kv, DAILY_BUDGET_USD: "3" },
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("daily_budget_exceeded");
  });

  it("予算内なら通常どおり(ガードの次段へ進む)", async () => {
    const { spendKey } = await import("../src/lib/costlog.js");
    const { kv } = kvMock({ [spendKey(new Date())]: String(2_999_999) });
    const limiter = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    const res = await app.request(
      req("/api/analyze", { input: "a", clientId: "c-budget2" }, "203.0.113.20"),
      {},
      { OCTO_KV: kv, DAILY_BUDGET_USD: "3", IP_RATE_LIMITER: limiter },
    );
    // 予算は通過し、次の IP バースト制限で止まる
    expect(((await res.json()) as { error: string }).error).toBe("ip_rate_limited");
  });

  it("logCost が当日の原価を積み上げる", async () => {
    const { CostCollector, logCost, readDailySpendUsd } = await import("../src/lib/costlog.js");
    const { kv } = kvMock();
    const now = new Date();
    for (const cost of [0.0012, 0.0008]) {
      const col = new CostCollector();
      col.record({ role: "synth", model: "m", inTok: 1, outTok: 1, estCost: cost, ms: 1, estimated: false });
      await logCost(kv, `r-${cost}`, col, { quorum: "4/4", fallback: false }, now);
    }
    expect(await readDailySpendUsd(kv, now)).toBeCloseTo(0.002, 6);
  });
});
