import { describe, expect, it } from "vitest";
import {
  buildReports,
  buildSynthUserText,
  splitAnswerTensionSummary,
} from "../src/lib/synthesize.js";
import type { NodeResult, Opinion } from "../src/types.js";

function op(claim: string, weight = 0.8): Opinion {
  return { claim, weight, why: "理由" };
}

function node(partial: Partial<NodeResult>): NodeResult {
  return {
    id: partial.id ?? "reason",
    status: partial.status ?? "ok",
    opinions: partial.opinions ?? [op("意見")],
    flag: partial.flag ?? null,
  };
}

describe("buildReports (Synthesizer入力の構築)", () => {
  it("flag付き・opinions空・非ok は除外し、レンズに軸情報を付与する", () => {
    const nodes: NodeResult[] = [
      node({ id: "reason", opinions: [op("合理の意見")] }), // 時の軸/see
      node({ id: "truth", opinions: [op("真実の意見", 0.2)] }), // 心の軸/feel
      node({ id: "risk", flag: "off_topic", opinions: [op("除外")] }),
      node({ id: "step", opinions: [] }),
      node({ id: "future", status: "parse_error", opinions: [] }),
    ];
    const reports = buildReports(nodes);

    // 残るのは reason と truth の2件
    expect(reports).toHaveLength(2);
    const reason = reports.find((r) => r.lens === "論理");
    expect(reason?.axis).toBe("時の軸");
    expect(reason?.square).toBe("see");
    const truth = reports.find((r) => r.lens === "鏡");
    expect(truth?.axis).toBe("心の軸");
    expect(truth?.square).toBe("feel");
  });
});

describe("buildSynthUserText", () => {
  it("軸ごとに対角2腕をまとめて渡す", () => {
    const nodes: NodeResult[] = [
      node({ id: "reason", opinions: [op("R")] }), // 時の軸
      node({ id: "future", opinions: [op("F")] }), // 時の軸
      node({ id: "emotion", opinions: [op("E")] }), // 心の軸
    ];
    const text = buildSynthUserText("入力", "", buildReports(nodes));
    expect(text).toContain("[今回の入力]");
    expect(text).toContain("軸ごとの報告");
    // 時の軸に2腕(論理/望遠)が同居している
    expect(text).toContain("時の軸");
    expect(text).toContain("論理");
    expect(text).toContain("望遠");
  });

  it("要約がなければ会話要約セクションを含めない", () => {
    const text = buildSynthUserText("入力", "", []);
    expect(text).not.toContain("[会話要約]");
  });
});

describe("splitAnswerTensionSummary (TENSION + SUMMARY)", () => {
  it("本文 / TENSION / SUMMARY を分離する", () => {
    const text =
      "これが回答本文です。\n" +
      '---TENSION--- {"axis":"心の軸","reason":"感情と真実が張り合う"}\n' +
      "---SUMMARY---\n更新された会話要約";
    const r = splitAnswerTensionSummary(text, "旧要約");
    expect(r.answer).toBe("これが回答本文です。");
    expect(r.tension).toEqual({ axis: "心の軸", reason: "感情と真実が張り合う" });
    expect(r.summary).toBe("更新された会話要約");
  });

  it("TENSION 欠落時は tension=null(非致命)、SUMMARY は機能する", () => {
    const text = "回答本文\n---SUMMARY---\n要約だけ";
    const r = splitAnswerTensionSummary(text, "旧");
    expect(r.tension).toBeNull();
    expect(r.answer).toBe("回答本文");
    expect(r.summary).toBe("要約だけ");
  });

  it("マーカー無しなら全体が回答、tension=null、要約は旧値維持", () => {
    const r = splitAnswerTensionSummary("マーカーなしの回答", "旧要約");
    expect(r.answer).toBe("マーカーなしの回答");
    expect(r.tension).toBeNull();
    expect(r.summary).toBe("旧要約");
  });

  it("TENSION の axis が不正なら tension=null", () => {
    const text = "本文\n---TENSION--- {\"reason\":\"axisなし\"}\n---SUMMARY---\n要約";
    const r = splitAnswerTensionSummary(text, "");
    expect(r.tension).toBeNull();
  });

  it("要約は300字に切り詰め", () => {
    const long = "あ".repeat(400);
    const r = splitAnswerTensionSummary(`回答\n---SUMMARY---\n${long}`, "");
    expect(r.summary.length).toBe(300);
  });
});
