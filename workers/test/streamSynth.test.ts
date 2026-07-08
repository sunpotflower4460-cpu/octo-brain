import { describe, expect, it } from "vitest";
import { DepthStreamCutter } from "../src/lib/synthesize.js";

// デルタ列を cutter に流し、emit された本文トークンの連結と最終result を得る
function run(deltas: string[], oldSummary = "旧要約") {
  const cutter = new DepthStreamCutter();
  let emitted = "";
  for (const d of deltas) emitted += cutter.push(d);
  emitted += cutter.flushRemaining();
  return { emitted, result: cutter.result(oldSummary) };
}

describe("DepthStreamCutter (ストリームでの TENSION/SUMMARY 切り出し)", () => {
  it("本文トークンだけを emit し、TENSION/要約はストリームに流さない", () => {
    const { emitted, result } = run([
      "これは",
      "回答です。",
      '\n---TENSION--- {"axis":"心の軸","reason":"r"}\n',
      "---SUMMARY---\n",
      "新しい要約",
    ]);
    expect(emitted).toBe("これは回答です。\n");
    expect(emitted).not.toContain("TENSION");
    expect(emitted).not.toContain("新しい要約");
    expect(result.answer).toBe("これは回答です。");
    expect(result.tension).toEqual({ axis: "心の軸", reason: "r" });
    expect(result.summary).toBe("新しい要約");
  });

  it("TENSIONマーカーが1文字ずつ来ても漏れない", () => {
    const marker = '---TENSION--- {"axis":"時の軸","reason":"r"}\n---SUMMARY---\n要約'.split(
      "",
    );
    const { emitted, result } = run(["回答本文", ...marker]);
    expect(emitted).toBe("回答本文");
    expect(emitted).not.toContain("-");
    expect(result.answer).toBe("回答本文");
    expect(result.tension?.axis).toBe("時の軸");
    expect(result.summary).toBe("要約");
  });

  it("マーカーが無ければ全文を本文として emit、tension=null、要約は旧値維持", () => {
    const { emitted, result } = run(["マーカー", "なしの回答"], "元の要約");
    expect(emitted).toBe("マーカーなしの回答");
    expect(result.answer).toBe("マーカーなしの回答");
    expect(result.tension).toBeNull();
    expect(result.summary).toBe("元の要約");
  });

  it("1文字ずつの細かいストリームでも本文が連結される", () => {
    const text =
      '短い答え。\n---TENSION--- {"axis":"動の軸","reason":"r"}\n---SUMMARY---\nよう';
    const { emitted, result } = run(text.split(""));
    expect(emitted).toBe("短い答え。\n");
    expect(result.answer).toBe("短い答え。");
    expect(result.tension?.axis).toBe("動の軸");
    expect(result.summary).toBe("よう");
  });
});
