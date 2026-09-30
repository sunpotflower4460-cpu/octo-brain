import { describe, expect, it } from "vitest";
import { MODELS } from "../src/config/models.js";

// 本番設定の健全性: プレースホルダー・単価0のままデプロイしない。
describe("MODELS 本番設定", () => {
  for (const [role, cfg] of Object.entries(MODELS)) {
    it(`${role}: model/baseURL/単価が設定済み`, () => {
      expect(cfg.model).not.toMatch(/SET_ME/);
      if (cfg.provider === "openai-compat") {
        expect(cfg.baseURL).toMatch(/^https:\/\//);
      }
      expect(cfg.pricePerMTokIn).toBeGreaterThan(0);
      expect(cfg.pricePerMTokOut).toBeGreaterThan(0);
    });
  }
});
