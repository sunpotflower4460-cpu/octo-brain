import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/callModel.js", () => ({ callModel: vi.fn() }));

import { callModel } from "../src/lib/callModel.js";
import { verify } from "../src/lib/verify.js";
import type { Env, ModelCallResult } from "../src/types.js";

const mockedCall = vi.mocked(callModel);
const env: Env = { OCTO_KV: {} as KVNamespace, DEEPSEEK_API_KEY: "k" };

function result(text: string): ModelCallResult {
  return { text, inTok: 0, outTok: 0, ms: 0, estimated: false };
}

describe("verify", () => {
  it("pass / pass. / PASS! は無修正", async () => {
    for (const t of ["pass", "pass.", "PASS!", "  pass。  "]) {
      mockedCall.mockResolvedValueOnce(result(t));
      const r = await verify("元の回答", { env });
      expect(r).toEqual({ text: "元の回答", modified: false });
    }
  });

  it("pass 以外の同程度の長さの修正は修正済み本文として採用", async () => {
    mockedCall.mockResolvedValueOnce(result("元の回答はこちらです"));
    const r = await verify("元の回答はこれです", { env });
    expect(r.modified).toBe(true);
    expect(r.text).toBe("元の回答はこちらです");
  });

  it("出力上限で切れた修正案は棄却して元の回答を採用", async () => {
    mockedCall.mockResolvedValueOnce({ ...result("元の回答はこれで"), truncated: true });
    const r = await verify("元の回答はこれです", { env });
    expect(r).toEqual({ text: "元の回答はこれです", modified: false, rejected: "truncated" });
  });

  it("短文への置換(例: 問題ありません。)は最小修正ではないので棄却", async () => {
    mockedCall.mockResolvedValueOnce(result("問題ありません。"));
    const long = "これは十分に長い元の回答です。".repeat(10);
    const r = await verify(long, { env });
    expect(r).toEqual({ text: long, modified: false, rejected: "length_mismatch" });
  });

  it("大幅な加筆も棄却", async () => {
    mockedCall.mockResolvedValueOnce(result("元の回答".repeat(5)));
    const r = await verify("元の回答", { env });
    expect(r.rejected).toBe("length_mismatch");
  });

  it("空応答は安全側で無修正", async () => {
    mockedCall.mockResolvedValueOnce(result("   "));
    const r = await verify("元の回答", { env });
    expect(r).toEqual({ text: "元の回答", modified: false });
  });
});

describe("検証役の前置き混入を防ぐ", () => {
  it("修正理由の前置きが付いた修正案は棄却して元の回答を採用", async () => {
    const original =
      "「批判されると落ち込む」\n\n見立てには共通点があります。" +
      "批判を自分の価値の判定として受け取っている。".repeat(6);
    mockedCall.mockResolvedValueOnce(
      result("「腕たち」は誤記のため修正します。\n\n" + original.replace("見立て", "私たちの見立て")),
    );
    const r = await verify(original, { env });
    expect(r).toEqual({ text: original, modified: false, rejected: "preamble" });
  });

  it("書き出しを保った最小修正は採用", async () => {
    const original = "「批判されると落ち込む」\n\n必ず治ります。批判を自分の価値の判定として受け取っている。";
    const revised = "「批判されると落ち込む」\n\n和らぐことが多いです。批判を自分の価値の判定として受け取っている。";
    mockedCall.mockResolvedValueOnce(result(revised));
    const r = await verify(original, { env });
    expect(r.modified).toBe(true);
    expect(r.text).toBe(revised);
  });
});
