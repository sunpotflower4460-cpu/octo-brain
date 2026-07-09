import { describe, expect, it } from "vitest";
import { canResonate, toggleSelection, type Selected } from "./pairSelect";

const sel = (lens: string, i: number): Selected => ({
  key: `${lens}:${i}`,
  lens,
  claim: `${lens}-${i}`,
});

describe("toggleSelection", () => {
  it("空から1つ選ぶ", () => {
    const r = toggleSelection([], sel("risk", 0));
    expect(r.selected).toHaveLength(1);
    expect(r.rejected).toBe(false);
  });

  it("異なるlensの2つを選べる", () => {
    let s: Selected[] = [];
    s = toggleSelection(s, sel("risk", 0)).selected;
    const r = toggleSelection(s, sel("values", 0));
    expect(r.selected).toHaveLength(2);
    expect(canResonate(r.selected)).toBe(true);
  });

  it("同一lensの2つ目は拒否(rejected)", () => {
    const s = [sel("risk", 0)];
    const r = toggleSelection(s, sel("risk", 1)); // 同じ risk
    expect(r.rejected).toBe(true);
    expect(r.selected).toHaveLength(1);
  });

  it("選択済みをもう一度押すと解除", () => {
    const s = [sel("risk", 0)];
    const r = toggleSelection(s, sel("risk", 0));
    expect(r.selected).toHaveLength(0);
    expect(r.rejected).toBe(false);
  });

  it("3つ目を選ぶと最初が外れる(FIFO)", () => {
    const s = [sel("risk", 0), sel("values", 0)];
    const r = toggleSelection(s, sel("reason", 0));
    expect(r.selected.map((x) => x.lens)).toEqual(["values", "reason"]);
  });
});

describe("canResonate", () => {
  it("異なるlensの2つで true", () => {
    expect(canResonate([sel("risk", 0), sel("values", 0)])).toBe(true);
  });
  it("1つ以下は false", () => {
    expect(canResonate([sel("risk", 0)])).toBe(false);
    expect(canResonate([])).toBe(false);
  });
});
