import { describe, expect, it } from "vitest";
import { armsForAxis, armsForLenses, displayFor } from "./nodeDisplay";

describe("armsForAxis (深化で光る対角2腕)", () => {
  it("軸ラベルから対角2腕の腕番号を返す(index が4離れる)", () => {
    expect(armsForAxis("時の軸").sort()).toEqual([0, 4]); // reason/future
    expect(armsForAxis("心の軸").sort()).toEqual([1, 5]); // emotion/truth
    expect(armsForAxis("動の軸").sort()).toEqual([2, 6]); // risk/step
    expect(armsForAxis("魂の軸").sort()).toEqual([3, 7]); // empathy/values
  });

  it("軸ラベルが文中に含まれていても拾う", () => {
    expect(armsForAxis("  心の軸  ").sort()).toEqual([1, 5]);
  });

  it("未知の軸・空文字は空配列", () => {
    expect(armsForAxis("謎の軸")).toEqual([]);
    expect(armsForAxis("")).toEqual([]);
  });
});

describe("armsForLenses (共鳴で光る2腕)", () => {
  it("レンズID配列→腕番号配列(深化と同じ index マッピング)", () => {
    expect(armsForLenses(["reason", "values"])).toEqual([0, 7]);
    expect(armsForLenses(["emotion", "step"])).toEqual([1, 6]);
  });
  it("実在しないIDは除外", () => {
    expect(armsForLenses(["risk", "bogus"])).toEqual([2]);
  });
});

describe("displayFor", () => {
  it("新レンズの表示名を返す", () => {
    expect(displayFor("truth").uiName).toBe("鏡");
    expect(displayFor("empathy").emoji).toBe("🤝");
    expect(displayFor("reason").axisLabel).toBe("時の軸");
  });
  it("未知IDはフォールバック", () => {
    expect(displayFor("nope").emoji).toBe("🧩");
  });
});
