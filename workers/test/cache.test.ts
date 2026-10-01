import { describe, expect, it } from "vitest";
import { estimateCost, modelFor } from "../src/config/models.js";
import { cachedOf } from "../src/lib/callModel.js";
import type { Env } from "../src/types.js";

const env = (extra: Record<string, string> = {}) => ({ OPENAI_API_KEY: "k", ...extra }) as unknown as Env;

describe("キャッシュ済み入力の原価", () => {
  it("キャッシュ分は安い単価で計算する(Luna は 1/10)", () => {
    const luna = modelFor("node", env());
    const full = estimateCost(luna, 1000, 0);
    const cached = estimateCost(luna, 1000, 0, 1000);
    expect(cached).toBeCloseTo(full / 10, 10);
    // キャッシュ数が入力を超えていても入力までしか数えない
    expect(estimateCost(luna, 1000, 0, 5000)).toBeCloseTo(cached, 10);
  });
  it("usage からキャッシュ済みトークン数を取る(無ければ何も足さない)", () => {
    expect(cachedOf({ prompt_tokens_details: { cached_tokens: 1052 } })).toEqual({ cachedTok: 1052 });
    expect(cachedOf({ prompt_tokens_details: { cached_tokens: 0 } })).toEqual({});
    expect(cachedOf({})).toEqual({});
  });
});
