import { describe, expect, it } from "vitest";
import { axisByLabel } from "../src/config/nodes.js";
import { combineAbortSignals } from "../src/lib/abort.js";

describe("axisByLabel", () => {
  it("完全一致・id で解決する", () => {
    expect(axisByLabel("心の軸")?.id).toBe("heart");
    expect(axisByLabel("time")?.id).toBe("time");
  });

  it("単一軸の部分一致は許容する", () => {
    expect(axisByLabel("最も張り詰めたのは心の軸です")?.id).toBe("heart");
  });

  it("複数軸が含まれる曖昧文は null", () => {
    expect(axisByLabel("時の軸と心の軸")).toBeNull();
  });
});

describe("combineAbortSignals", () => {
  it("いずれかが abort したら合成 signal も abort", () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = combineAbortSignals(a.signal, b.signal);
    expect(combined.aborted).toBe(false);
    b.abort();
    expect(combined.aborted).toBe(true);
  });

  it("既に abort 済みの signal を渡すと即 abort", () => {
    const a = new AbortController();
    a.abort();
    const combined = combineAbortSignals(a.signal, new AbortController().signal);
    expect(combined.aborted).toBe(true);
  });
});
