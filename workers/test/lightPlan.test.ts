import { describe, expect, it } from "vitest";
import { parseAxes } from "../src/lib/worlds.js";
import { lensPlan, lightStyle, planWorldCount } from "../src/lib/analyze.js";
import { ALL_LENS_IDS, nodeSharedSystem } from "../src/config/nodes.js";
import type { Env } from "../src/types.js";

const env = (extra: Record<string, string> = {}) => ({ OPENAI_API_KEY: "k", ...extra }) as unknown as Env;

describe("ライトの腕の選び方", () => {
  it("いちばん問われている2軸を読み取る", () => {
    expect(parseAxes('{"axes":["heart","soul"],"worlds":[]}')).toEqual(["heart", "soul"]);
    expect(parseAxes('{"axes":["heart","heart"]}')).toBeNull();
    expect(parseAxes('{"axes":["x"]}')).toBeNull();
    expect(parseAxes("{}")).toBeNull();
  });
  it("既定はドメインで2軸=4腕", () => {
    expect(lightStyle(env())).toBe("domain");
    const p = lensPlan("light", "work", { worlds: [], research: null, mode: "explore", axes: ["heart", "soul"] }, env());
    expect(p.lensIds).toEqual(["reason", "future", "risk", "step"]);
    expect(p.compact).toBe(false);
  });
  it("planner は世界の選定が選んだ2軸の4腕(読めなければドメイン)", () => {
    const e = env({ LIGHT_STYLE: "planner" });
    expect(lensPlan("light", "work", { worlds: [], research: null, mode: "explore", axes: ["heart", "soul"] }, e).lensIds)
      .toEqual(["emotion", "truth", "empathy", "values"]);
    expect(lensPlan("light", "work", null, e).lensIds).toEqual(["reason", "future", "risk", "step"]);
  });
  it("compact8 はライトでも8腕を簡潔版で、世界も8つ選ぶ", () => {
    const e = env({ LIGHT_STYLE: "compact8" });
    const p = lensPlan("light", "work", null, e);
    expect(p.lensIds).toEqual(ALL_LENS_IDS);
    expect(p.compact).toBe(true);
    expect(p.required).toBe(4);
    expect(planWorldCount("light", e)).toBe(8);
    expect(planWorldCount("light", env())).toBe(4);
    // ディープは設定によらず8腕・簡潔版ではない
    expect(lensPlan("deep", "work", null, e).compact).toBe(false);
  });
  it("簡潔版の共有プロンプトには出力を抑える指示が入る", () => {
    expect(nodeSharedSystem("world", true)).toContain("簡潔に出す");
    expect(nodeSharedSystem("world")).not.toContain("簡潔に出す");
  });
});
