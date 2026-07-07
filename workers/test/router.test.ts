import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyRoute, parseRoute } from "../src/lib/router.js";
import type { Env } from "../src/types.js";

const env: Env = {
  OCTO_KV: {} as KVNamespace,
  DEEPSEEK_API_KEY: "test-key",
};

function mockFetch(content: string, status = 200) {
  const fn = vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ choices: [{ message: { content } }], usage: {} }),
        { status, headers: { "content-type": "application/json" } },
      ),
    ),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseRoute", () => {
  it("simple/normal/complex を判別する", () => {
    expect(parseRoute("simple")).toBe("simple");
    expect(parseRoute("NORMAL")).toBe("normal");
    expect(parseRoute("  complex  ")).toBe("complex");
    expect(parseRoute("これは complex な問題です")).toBe("complex");
  });

  it("判別不能なら normal", () => {
    expect(parseRoute("わかりません")).toBe("normal");
    expect(parseRoute("")).toBe("normal");
  });
});

describe("classifyRoute", () => {
  it("モデル応答を分類に変換する", async () => {
    mockFetch("complex");
    const route = await classifyRoute("難しい問い", { env });
    expect(route).toBe("complex");
  });

  it("不正応答は normal にフォールバック", async () => {
    mockFetch("42");
    const route = await classifyRoute("入力", { env });
    expect(route).toBe("normal");
  });

  it("呼び出し失敗(5xx)でも normal を返す", async () => {
    mockFetch("err", 500);
    const route = await classifyRoute("入力", { env });
    expect(route).toBe("normal");
  });
});
