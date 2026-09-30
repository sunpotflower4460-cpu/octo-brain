import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/analyze.js", () => ({
  runAnalyze: vi.fn(async () => {
    throw new Error("callModel(synth) HTTP 401: {\"error\":\"invalid key sk-abcdef1234567890\"}");
  }),
}));

import app from "../src/index.js";
import { validResonance } from "../src/lib/synthesize.js";
import type { NodeResult } from "../src/types.js";

function kvStub(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
  } as unknown as KVNamespace;
}

describe("エラー詳細をクライアントに返さない(H5)", () => {
  it("上流の生エラーは pipeline_error のみ返し、詳細はログへ(キーは伏せる)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await app.request(
      new Request("http://x/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "a", clientId: "c-h5" }),
      }),
      {},
      { OCTO_KV: kvStub() },
    );
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: "pipeline_error" });
    expect(body).not.toContain("401");
    const logged = String(log.mock.calls[0]?.[1] ?? "");
    expect(logged).toContain("HTTP 401");
    expect(logged).not.toContain("sk-abcdef1234567890");
    log.mockRestore();
  });
});

describe("リクエスト本文の上限", () => {
  it("64KB 超は JSON を読まずに 413", async () => {
    const res = await app.request(
      new Request("http://x/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(70 * 1024) },
        body: "x".repeat(70 * 1024),
      }),
      {},
      { OCTO_KV: kvStub() },
    );
    expect(res.status).toBe(413);
  });
});

describe("共鳴レンズの検証(H3)", () => {
  const ok = (id: string): NodeResult =>
    ({ id, status: "ok", opinions: [{ claim: "c", weight: 0.8, why: "w" }], flag: null }) as NodeResult;
  const pair = (a: string, b: string) =>
    ({ a: { lens: a, claim: "x" }, b: { lens: b, claim: "y" }, root: "r" }) as never;

  it("両方とも実際に使えた腕なら採用", () => {
    expect(validResonance(pair("reason", "risk"), [ok("reason"), ok("risk")])).not.toBeNull();
  });
  it("起動していない腕を含むなら棄却", () => {
    expect(validResonance(pair("reason", "emotion"), [ok("reason"), ok("risk")])).toBeNull();
  });
  it("失敗した腕を含むなら棄却", () => {
    const failed = { id: "risk", status: "error", opinions: [], flag: null } as NodeResult;
    expect(validResonance(pair("reason", "risk"), [ok("reason"), failed])).toBeNull();
  });
});

describe("/api/health の設定検証", () => {
  it("APIキー未登録なら 503 と役割名だけを返す", async () => {
    const res = await app.request("/api/health", {}, { OCTO_KV: kvStub() });
    expect(res.status).toBe(503);
    const j = (await res.json()) as { ok: boolean; problems: string[] };
    expect(j.ok).toBe(false);
    expect(j.problems).toContain("synth:api_key_missing");
    expect(JSON.stringify(j)).not.toContain("DEEPSEEK");
  });
  it("設定が揃っていれば 200", async () => {
    const res = await app.request("/api/health", {}, { OCTO_KV: kvStub(), DEEPSEEK_API_KEY: "k" });
    expect(res.status).toBe(200);
  });
});
