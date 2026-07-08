import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyDomain, parseDomain } from "../src/lib/router.js";
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

describe("parseDomain", () => {
  it("ドメイン語を判別する", () => {
    expect(parseDomain("love")).toBe("love");
    expect(parseDomain("WORK")).toBe("work");
    expect(parseDomain("これは money の相談")).toBe("money");
    expect(parseDomain("family")).toBe("family");
    expect(parseDomain("self")).toBe("self");
  });

  it("判別不能なら general", () => {
    expect(parseDomain("わかりません")).toBe("general");
    expect(parseDomain("")).toBe("general");
    expect(parseDomain("general")).toBe("general");
  });
});

describe("classifyDomain", () => {
  it("モデル応答をドメインに変換する", async () => {
    mockFetch("work");
    expect(await classifyDomain("転職すべきか", { env })).toBe("work");
  });

  it("不正応答は general にフォールバック", async () => {
    mockFetch("42");
    expect(await classifyDomain("入力", { env })).toBe("general");
  });

  it("呼び出し失敗(5xx)でも general を返す", async () => {
    mockFetch("err", 500);
    expect(await classifyDomain("入力", { env })).toBe("general");
  });
});
