import { describe, expect, it } from "vitest";
import app from "../src/index.js";

// P7: Capacitor(iOS/Android WebView)の localhost 系オリジンが CORS 許可されること。
function envStub() {
  const kv = {
    get: async () => null,
    put: async () => {},
  } as unknown as KVNamespace;
  return { OCTO_KV: kv };
}

async function preflight(origin: string, env: { OCTO_KV: KVNamespace }) {
  return app.request(
    new Request("http://x/api/analyze", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
      },
    }),
    {},
    env,
  );
}

describe("CORS — Capacitor / dev オリジン", () => {
  it("capacitor://localhost を許可(エコー)する", async () => {
    const res = await preflight("capacitor://localhost", envStub());
    expect(res.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
  });

  it("http://localhost(Android WebView)を許可する", async () => {
    const res = await preflight("http://localhost", envStub());
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost");
  });

  it("Vite dev オリジンを許可する", async () => {
    const res = await preflight("http://localhost:5173", envStub());
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("ALLOWED_ORIGIN(本番)を許可する", async () => {
    const env = { ...envStub(), ALLOWED_ORIGIN: "https://octobrain.example" } as {
      OCTO_KV: KVNamespace;
    };
    const res = await preflight("https://octobrain.example", env);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://octobrain.example");
  });

  it("未許可オリジンはエコーしない(既定へフォールバック)", async () => {
    const res = await preflight("https://evil.example", envStub());
    expect(res.headers.get("access-control-allow-origin")).not.toBe("https://evil.example");
  });
});
