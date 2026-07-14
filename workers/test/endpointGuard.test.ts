import { describe, expect, it } from "vitest";
import app from "../src/index.js";
import { quotaKey } from "../src/lib/costlog.js";

// P5: エンドポイント入口のガード(429)がモデル呼び出し前に効くことを検証する。
// いずれのケースもパイプラインに到達しないため、実モデル/APIキー不要。

function envWith(seed: Record<string, string> = {}): { OCTO_KV: KVNamespace } {
  const store = new Map<string, string>(Object.entries(seed));
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  } as unknown as KVNamespace;
  return { OCTO_KV: kv };
}

function post(body: unknown) {
  return new Request("http://x/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = { input: "テスト", clientId: "c-guard", plan: "light" };

describe("エンドポイントガード(429)", () => {
  it("クォータ上限到達で 429 quota_exceeded", async () => {
    const env = envWith({ [quotaKey("c-guard", new Date())]: "100" });
    const res = await app.request(post(VALID), {}, env);
    expect(res.status).toBe(429);
    const j = (await res.json()) as { error: string; limit: number; used: number };
    expect(j.error).toBe("quota_exceeded");
    expect(j.limit).toBe(100);
    expect(j.used).toBe(100);
  });

  it("処理中の同時実行は 429 in_progress", async () => {
    const rl = JSON.stringify({ inFlight: true, lockUntil: Date.now() + 60_000, last: 0 });
    const env = envWith({ "rl:c-guard": rl });
    const res = await app.request(post(VALID), {}, env);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("in_progress");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("最小間隔未満は 429 too_frequent", async () => {
    const rl = JSON.stringify({ inFlight: false, lockUntil: 0, last: Date.now() });
    const env = envWith({ "rl:c-guard": rl });
    const res = await app.request(post(VALID), {}, env);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("too_frequent");
  });

  it("バリデーション不正はガード前に 400", async () => {
    const env = envWith();
    const res = await app.request(post({ clientId: "c" }), {}, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("input_required");
  });
});
