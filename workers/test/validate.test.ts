import { describe, expect, it } from "vitest";
import { validateAnalyzeBody } from "../src/index.js";

// P5: 入力バリデーションの異常系(空・超過・型違い・欠落)。
describe("validateAnalyzeBody 異常系", () => {
  it("input 欠落は input_required", () => {
    expect(validateAnalyzeBody({ clientId: "c" })).toMatchObject({
      ok: false,
      error: "input_required",
    });
  });

  it("input が空文字は input_required", () => {
    expect(validateAnalyzeBody({ input: "", clientId: "c" })).toMatchObject({
      ok: false,
      error: "input_required",
    });
  });

  it("input が文字列以外は input_required(型違い)", () => {
    expect(validateAnalyzeBody({ input: 123, clientId: "c" })).toMatchObject({
      ok: false,
      error: "input_required",
    });
  });

  it("input 4000字超は input_too_long", () => {
    const long = "あ".repeat(4001);
    const r = validateAnalyzeBody({ input: long, clientId: "c" });
    expect(r).toMatchObject({ ok: false, error: "input_too_long" });
  });

  it("summary 500字超は summary_too_long", () => {
    const r = validateAnalyzeBody({
      input: "ok",
      summary: "s".repeat(501),
      clientId: "c",
    });
    expect(r).toMatchObject({ ok: false, error: "summary_too_long" });
  });

  it("clientId 欠落は clientId_required", () => {
    expect(validateAnalyzeBody({ input: "ok" })).toMatchObject({
      ok: false,
      error: "clientId_required",
    });
  });

  it("不正な plan は invalid_plan", () => {
    expect(
      validateAnalyzeBody({ input: "ok", clientId: "c", plan: "ultra" }),
    ).toMatchObject({ ok: false, error: "invalid_plan" });
  });

  it("body が null/非オブジェクトでも落ちない", () => {
    expect(validateAnalyzeBody(null)).toMatchObject({ ok: false });
    expect(validateAnalyzeBody("nope")).toMatchObject({ ok: false });
    expect(validateAnalyzeBody(undefined)).toMatchObject({ ok: false });
  });

  it("正常系: 既定 plan は light", () => {
    const r = validateAnalyzeBody({ input: "ok", clientId: "c" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.plan).toBe("light");
      expect(r.value.input).toBe("ok");
    }
  });

  it("境界値: input ちょうど4000字は許可", () => {
    const r = validateAnalyzeBody({ input: "a".repeat(4000), clientId: "c" });
    expect(r.ok).toBe(true);
  });
});
