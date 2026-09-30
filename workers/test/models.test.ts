import { describe, expect, it } from "vitest";
import { MODEL_ROLES, PROFILES, activeProfile, modelFor } from "../src/config/models.js";

// 本番設定の健全性: プレースホルダー・単価0のままデプロイしない。
describe("モデル構成(プロファイル)", () => {
  for (const [profile, models] of Object.entries(PROFILES)) {
    for (const role of MODEL_ROLES) {
      it(`${profile}/${role}: model/baseURL/単価が設定済み`, () => {
        const cfg = models[role];
        expect(cfg.model).not.toMatch(/SET_ME/);
        if (cfg.provider === "openai-compat") expect(cfg.baseURL).toMatch(/^https:\/\//);
        expect(cfg.pricePerMTokIn).toBeGreaterThan(0);
        expect(cfg.pricePerMTokOut).toBeGreaterThan(0);
      });
    }
  }

  it("luna は推論オフ・max_completion_tokens(推論トークンで課金と上限を食わない)", () => {
    for (const role of MODEL_ROLES) {
      expect(PROFILES.luna[role].extraBody).toEqual({ reasoning_effort: "none" });
      expect(PROFILES.luna[role].maxTokensParam).toBe("max_completion_tokens");
    }
  });
});

describe("activeProfile", () => {
  it("OPENAI_API_KEY が無ければ deepseek", () => {
    expect(activeProfile({ DEEPSEEK_API_KEY: "k" })).toBe("deepseek");
  });
  it("OPENAI_API_KEY が登録されていれば luna に自動で切り替わる", () => {
    expect(activeProfile({ OPENAI_API_KEY: "k" })).toBe("luna");
    expect(modelFor("synth", { OPENAI_API_KEY: "k" }).keyEnv).toBe("OPENAI_API_KEY");
  });
  it("MODEL_PROFILE で明示でき、不正値は無視する", () => {
    expect(activeProfile({ OPENAI_API_KEY: "k", MODEL_PROFILE: "deepseek" })).toBe("deepseek");
    expect(activeProfile({ MODEL_PROFILE: "luna" })).toBe("luna");
    expect(activeProfile({ MODEL_PROFILE: "gpt" })).toBe("deepseek");
  });
});

describe("LUNA_SYNTH_REASONING(統合脳だけ推論オン)", () => {
  const env = { OPENAI_API_KEY: "k", LUNA_SYNTH_REASONING: "low" };
  it("synth だけ推論 low にし、上限に推論の予算を足す", () => {
    const synth = modelFor("synth", env);
    expect(synth.extraBody).toEqual({ reasoning_effort: "low" });
    expect(synth.maxTokens).toBe(2000);
    expect(synth.reasoningBudget).toBe(4000);
  });
  it("ほかの役割は推論なしのまま", () => {
    expect(modelFor("node", env).extraBody).toEqual({ reasoning_effort: "none" });
    expect(modelFor("verifier", env).maxTokens).toBe(2000);
  });
  it("deepseek 構成・不正値では無視する", () => {
    expect(modelFor("synth", { LUNA_SYNTH_REASONING: "low" }).model).not.toBe("gpt-6-luna");
    expect(modelFor("synth", { OPENAI_API_KEY: "k", LUNA_SYNTH_REASONING: "max" }).extraBody).toEqual({
      reasoning_effort: "none",
    });
  });
});
