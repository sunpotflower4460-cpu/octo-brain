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
