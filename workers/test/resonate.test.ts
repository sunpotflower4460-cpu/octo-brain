import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/callModel.js", () => ({ callModel: vi.fn() }));

import { callModel } from "../src/lib/callModel.js";
import { runResonate, validateResonancePair } from "../src/lib/resonate.js";
import type { ChatMessage, Env, ModelCallResult } from "../src/types.js";

const mockedCall = vi.mocked(callModel);

function result(text: string): ModelCallResult {
  return { text, inTok: 0, outTok: 0, ms: 0, estimated: false };
}

function makeEnv(): { env: Env; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  } as unknown as KVNamespace;
  return { env: { OCTO_KV: kv, DEEPSEEK_API_KEY: "k" }, store };
}

beforeEach(() => mockedCall.mockReset());

describe("validateResonancePair", () => {
  it("正常なペアを受理", () => {
    const v = validateResonancePair({
      a: { lens: "risk", claim: "引き返せない" },
      b: { lens: "values", claim: "自律" },
    });
    expect(v.ok).toBe(true);
  });

  it("実在しない lens は invalid_lens", () => {
    const v = validateResonancePair({
      a: { lens: "bogus", claim: "x" },
      b: { lens: "values", claim: "y" },
    });
    expect(v).toEqual({ ok: false, error: "invalid_lens" });
  });

  it("同一 lens は same_lens", () => {
    const v = validateResonancePair({
      a: { lens: "risk", claim: "x" },
      b: { lens: "risk", claim: "y" },
    });
    expect(v).toEqual({ ok: false, error: "same_lens" });
  });

  it("claim が120字超なら claim_too_long", () => {
    const v = validateResonancePair({
      a: { lens: "risk", claim: "あ".repeat(121) },
      b: { lens: "values", claim: "y" },
    });
    expect(v).toEqual({ ok: false, error: "claim_too_long" });
  });

  it("claim 空は invalid_lens 扱い(pair不成立)", () => {
    const v = validateResonancePair({
      a: { lens: "risk", claim: "" },
      b: { lens: "values", claim: "y" },
    });
    expect(v.ok).toBe(false);
  });
});

describe("runResonate", () => {
  it("1コール(synth)で第三の選択肢を返し、costlog に計上", async () => {
    mockedCall.mockImplementation(
      (() => Promise.resolve(result("第三の選択肢: 守りを自由の器にする"))) as unknown as typeof callModel,
    );
    const { env, store } = makeEnv();

    const res = await runResonate(
      {
        input: "転職すべきか",
        summary: "",
        resonance: {
          a: { lens: "risk", claim: "引き返せない時期" },
          b: { lens: "values", claim: "自律を大切に" },
        },
        priorAnswer: "以前の回答",
        clientId: "c1",
      },
      { env, now: new Date(), requestId: "rsn-1" },
    );

    expect(res.answer).toBe("第三の選択肢: 守りを自由の器にする");
    expect(res.meta.pair.a.lens).toBe("risk");
    expect(res.meta.pair.b.lens).toBe("values");

    // synth 1コール
    expect(mockedCall).toHaveBeenCalledTimes(1);
    expect(mockedCall.mock.calls[0][0]).toBe("synth");
    // user 側に両方の claim が渡る(掛け合わせ)
    const userMsg = (mockedCall.mock.calls[0][1] as ChatMessage[])[1].content;
    expect(userMsg).toContain("引き返せない時期");
    expect(userMsg).toContain("自律を大切に");

    // KV に原価記録
    expect([...store.keys()].some((k) => k.startsWith("cost:"))).toBe(true);
  });
});
