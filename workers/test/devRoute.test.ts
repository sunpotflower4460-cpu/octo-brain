import { describe, expect, it } from "vitest";
import app from "../src/index.js";

// 開発用ルート /api/dev/ping-model は ENVIRONMENT=development のときだけ有効。
// 未設定・production では 404(本番に開発用の入口を残さない / 安全側の既定)。

function ping(): Request {
  return new Request("http://x/api/dev/ping-model", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "__invalid__" }),
  });
}

describe("/api/dev/ping-model の有効範囲", () => {
  it("ENVIRONMENT=production では 404", async () => {
    const res = await app.request(ping(), {}, { ENVIRONMENT: "production" });
    expect(res.status).toBe(404);
  });

  it("ENVIRONMENT 未設定でも 404(安全側)", async () => {
    const res = await app.request(ping(), {}, {});
    expect(res.status).toBe(404);
  });

  it("ENVIRONMENT=development なら有効(不正roleで 400 まで到達)", async () => {
    const res = await app.request(ping(), {}, { ENVIRONMENT: "development" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_role");
  });
});

describe("/api/dev/baseline(比較評価用)は本番で無効", () => {
  it("ENVIRONMENT 未設定・production では 404", async () => {
    const req = () =>
      new Request("http://x/api/dev/baseline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "x" }),
      });
    expect((await app.request(req(), {}, {})).status).toBe(404);
    expect((await app.request(req(), {}, { ENVIRONMENT: "production" })).status).toBe(404);
  });
});

describe("開発環境の KV は本番と分ける", () => {
  it("ENVIRONMENT=development では KV のキーに dev: を付け、本番のキー(予算・利用回数)に触れない", async () => {
    const { default: app } = await import("../src/index.js");
    const store = new Map<string, string>();
    const kv = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => void store.set(k, v),
    } as unknown as KVNamespace;
    // 入力不備で早く返るが、その前の連打防止・利用回数のチェックで KV を読む/書く経路を通す
    await app.request(
      new Request("http://x/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: "a", clientId: "c-dev-1" }) }),
      {},
      { OCTO_KV: kv, ENVIRONMENT: "development" },
    );
    const keys = [...store.keys()];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith("dev:"))).toBe(true);
  });

  it("scopedKv は list の接頭辞にも付ける", async () => {
    const { scopedKv } = await import("../src/index.js");
    let seen = "";
    const kv = { list: async (o: { prefix: string }) => ((seen = o.prefix), { keys: [], list_complete: true }) } as unknown as KVNamespace;
    await scopedKv(kv, "dev:").list({ prefix: "cost:" });
    expect(seen).toBe("dev:cost:");
  });
});
