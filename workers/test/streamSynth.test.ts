import { describe, expect, it } from "vitest";
import { SummaryStreamCutter } from "../src/lib/synthesize.js";

// デルタ列を cutter に流し、emit された回答トークンの連結と最終result を得る
function run(deltas: string[], oldSummary = "旧要約") {
  const cutter = new SummaryStreamCutter();
  let emitted = "";
  for (const d of deltas) emitted += cutter.push(d);
  emitted += cutter.flushRemaining();
  return { emitted, result: cutter.result(oldSummary) };
}

describe("SummaryStreamCutter (ストリームでの ---SUMMARY--- 切り出し)", () => {
  it("回答トークンだけを emit し、要約はストリームに流さない", () => {
    const { emitted, result } = run([
      "これは",
      "回答です。",
      "\n---SUMMARY---\n",
      "新しい要約",
    ]);
    expect(emitted).toBe("これは回答です。\n");
    expect(emitted).not.toContain("---SUMMARY---");
    expect(emitted).not.toContain("新しい要約");
    expect(result.answer).toBe("これは回答です。");
    expect(result.summary).toBe("新しい要約");
  });

  it("マーカーがチャンクをまたいでも漏れない", () => {
    // "---SUMMARY---" を1文字ずつに割って流す
    const marker = "---SUMMARY---".split("");
    const { emitted, result } = run(["回答本文", ...marker, "要約テキスト"]);
    expect(emitted).toBe("回答本文");
    expect(emitted).not.toContain("-");
    expect(result.answer).toBe("回答本文");
    expect(result.summary).toBe("要約テキスト");
  });

  it("マーカーが無ければ全文を回答として emit し、要約は旧値を維持", () => {
    const { emitted, result } = run(["マーカー", "なしの回答"], "元の要約");
    expect(emitted).toBe("マーカーなしの回答");
    expect(result.answer).toBe("マーカーなしの回答");
    expect(result.summary).toBe("元の要約");
  });

  it("1文字ずつの細かいストリームでも回答が連結される", () => {
    const text = "短い答え。\n---SUMMARY---\nよう";
    const { emitted, result } = run(text.split(""));
    expect(emitted).toBe("短い答え。\n");
    expect(result.answer).toBe("短い答え。");
    expect(result.summary).toBe("よう");
  });
});
