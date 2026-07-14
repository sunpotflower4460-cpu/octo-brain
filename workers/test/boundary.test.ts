import { describe, expect, it } from "vitest";
import {
  detectBoundary,
  boundaryPrefix,
  withBoundaryPrefix,
} from "../src/lib/boundary.js";

describe("detectBoundary — math", () => {
  it("算術式を検出", () => {
    expect(detectBoundary("128 * 47 はいくつ")).toBe("math");
    expect(detectBoundary("3 + 5 を教えて")).toBe("math");
  });
  it("数学用語・計算依頼を検出", () => {
    expect(detectBoundary("2の平方根は?")).toBe("math");
    expect(detectBoundary("この方程式を解いて")).toBe("math");
    expect(detectBoundary("複利を計算してください")).toBe("math");
  });
});

describe("detectBoundary — recency", () => {
  it("最新/リアルタイム系を検出", () => {
    expect(detectBoundary("最新のAIニュースを教えて")).toBe("recency");
    expect(detectBoundary("今日の天気はどう?")).toBe("recency");
    expect(detectBoundary("現在の為替レートは?")).toBe("recency");
    expect(detectBoundary("ビットコインの価格を知りたい")).toBe("recency");
  });
});

describe("detectBoundary — 通常の相談は null(誤爆しない)", () => {
  it("感情/決断の相談は境界なし", () => {
    expect(detectBoundary("転職すべきか迷っている")).toBeNull();
    expect(detectBoundary("やりたいことが多すぎて絞れない")).toBeNull();
    expect(detectBoundary("上司に本音を言うべきか")).toBeNull();
    expect(detectBoundary("3つの選択肢で迷っている")).toBeNull(); // 数字はあるが算術ではない
    expect(detectBoundary("今の会社に残るか転職するか")).toBeNull(); // 「今の」だが情報要求ではない
  });
  it("空文字/未定義でも落ちない", () => {
    expect(detectBoundary("")).toBeNull();
    expect(detectBoundary(undefined as unknown as string)).toBeNull();
  });
});

describe("math を recency より優先", () => {
  it("両方の語を含むと math", () => {
    expect(detectBoundary("最新の株価を 100 * 1.05 で計算して")).toBe("math");
  });
});

describe("boundaryPrefix / withBoundaryPrefix", () => {
  it("種別ごとに正直な但し書き", () => {
    expect(boundaryPrefix("math")).toContain("計算");
    expect(boundaryPrefix("recency")).toContain("最新");
  });
  it("境界ありは冒頭に前置き、なしはそのまま", () => {
    const out = withBoundaryPrefix("本文です", "recency");
    expect(out.startsWith("※")).toBe(true);
    expect(out).toContain("本文です");
    expect(withBoundaryPrefix("本文です", null)).toBe("本文です");
  });
});
