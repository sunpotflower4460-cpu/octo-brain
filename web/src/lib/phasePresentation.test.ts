import { describe, expect, it } from "vitest";
import { MAIN_STEPS, planLabel, presentPhase } from "./phasePresentation";

describe("presentPhase", () => {
  it("4段階に step 1〜4 を割り当てる", () => {
    expect(presentPhase("routing").step).toBe(1);
    expect(presentPhase("nodes").step).toBe(2);
    expect(presentPhase("synth").step).toBe(3);
    expect(presentPhase("verify").step).toBe(4);
  });
  it("ユーザー向け文言は「解析」ではなく意味のある日本語", () => {
    expect(presentPhase("nodes").name).toBe("8つのレンズ");
    expect(presentPhase("synth").name).toBe("視点を織る");
  });
  it("MAIN_STEPS は4段階", () => {
    expect(MAIN_STEPS.map((s) => s.phase)).toEqual(["routing", "nodes", "synth", "verify"]);
  });
});

describe("planLabel", () => {
  it("技術用語ではなく分かる表示", () => {
    expect(planLabel("light").title).toBe("ライト");
    expect(planLabel("deep").title).toBe("ディープ");
    expect(planLabel("deep").desc).toContain("8つ");
  });
});
