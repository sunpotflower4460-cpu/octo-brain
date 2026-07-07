import { describe, expect, it } from "vitest";
import {
  buildReports,
  buildSynthUserText,
  splitAnswerAndSummary,
} from "../src/lib/synthesize.js";
import type { NodeResult } from "../src/types.js";

function node(partial: Partial<NodeResult>): NodeResult {
  return {
    id: partial.id ?? "counter",
    status: partial.status ?? "ok",
    points: partial.points ?? ["p"],
    confidence: partial.confidence ?? 0.8,
    flag: partial.flag ?? null,
  };
}

describe("buildReports (Synthesizer入力の構築)", () => {
  it("flag付き・空points は除外、confidence<0.4 は reference に格下げ", () => {
    const nodes: NodeResult[] = [
      node({ id: "assumptions", points: ["高信頼"], confidence: 0.9 }),
      node({ id: "gaps", points: ["低信頼"], confidence: 0.2 }),
      node({ id: "counter", points: ["除外"], flag: "off_topic" }),
      node({ id: "worst", points: [], confidence: 0.7 }),
      node({ id: "next", status: "parse_error", points: [], confidence: 0 }),
    ];
    const reports = buildReports(nodes);

    // 残るのは assumptions(primary) と gaps(reference) の2件
    expect(reports).toHaveLength(2);
    expect(reports[0]).toEqual({
      points: ["高信頼"],
      confidence: 0.9,
      weight: "primary",
    });
    expect(reports[1]).toEqual({
      points: ["低信頼"],
      confidence: 0.2,
      weight: "reference",
    });
  });

  it("境界値 0.4 は primary 扱い", () => {
    const reports = buildReports([node({ points: ["x"], confidence: 0.4 })]);
    expect(reports[0].weight).toBe("primary");
  });
});

describe("splitAnswerAndSummary (---SUMMARY--- パース)", () => {
  it("マーカーありなら回答と要約を分離する", () => {
    const text = "これが回答本文です。\n---SUMMARY---\n更新された会話要約";
    const r = splitAnswerAndSummary(text, "旧要約");
    expect(r.answer).toBe("これが回答本文です。");
    expect(r.summary).toBe("更新された会話要約");
  });

  it("マーカーなしなら回答全体を answer にし、要約は旧値を維持", () => {
    const r = splitAnswerAndSummary("マーカーのない回答", "旧要約");
    expect(r.answer).toBe("マーカーのない回答");
    expect(r.summary).toBe("旧要約");
  });

  it("要約は300字に切り詰め", () => {
    const long = "あ".repeat(400);
    const r = splitAnswerAndSummary(`回答\n---SUMMARY---\n${long}`, "");
    expect(r.summary.length).toBe(300);
  });

  it("マーカー後が空なら旧要約を維持", () => {
    const r = splitAnswerAndSummary("回答\n---SUMMARY---\n   ", "旧");
    expect(r.summary).toBe("旧");
  });
});

describe("buildSynthUserText", () => {
  it("要約がなければ会話要約セクションを含めない", () => {
    const text = buildSynthUserText("今回の入力", "", []);
    expect(text).not.toContain("[会話要約]");
    expect(text).toContain("[今回の入力]");
    expect(text).toContain("[ノードレポート]");
  });

  it("要約があれば含める", () => {
    const text = buildSynthUserText("入力", "これまでの要約", []);
    expect(text).toContain("[会話要約]");
    expect(text).toContain("これまでの要約");
  });
});
