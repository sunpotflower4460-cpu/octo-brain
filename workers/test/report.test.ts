import { describe, expect, it } from "vitest";
import {
  aggregateByDay,
  formatReport,
  dayFromCostKey,
  type DayEntry,
} from "../src/lib/report.js";
import type { StoredCostRecord } from "../src/lib/costlog.js";

function r(
  totalCost: number,
  fallback: boolean,
  ms: number | undefined,
  kind: string,
): StoredCostRecord {
  return { calls: [], totalCost, quorum: "x", fallback, ms, kind };
}

describe("dayFromCostKey", () => {
  it("cost:YYYYMMDD:id から日付を取り出す", () => {
    expect(dayFromCostKey("cost:20260714:abc-123")).toBe("20260714");
  });
  it("形式不一致は null", () => {
    expect(dayFromCostKey("quota:c:202607")).toBeNull();
    expect(dayFromCostKey("cost:bad:id")).toBeNull();
  });
});

describe("aggregateByDay", () => {
  const entries: DayEntry[] = [
    { day: "20260714", record: r(0.001, false, 5000, "analyze") },
    { day: "20260714", record: r(0.002, true, 9000, "analyze") },
    { day: "20260714", record: r(0.0005, false, 3000, "deepen") },
    { day: "20260713", record: r(0.001, false, 4000, "analyze") },
  ];

  it("日ごとに件数・総コスト・平均ms・fallback率・内訳を集計", () => {
    const rep = aggregateByDay(entries);
    expect(rep.rows.map((x) => x.day)).toEqual(["20260713", "20260714"]); // 昇順
    const d14 = rep.rows.find((x) => x.day === "20260714")!;
    expect(d14.count).toBe(3);
    expect(d14.totalCost).toBeCloseTo(0.0035, 10);
    expect(d14.avgMs).toBe(Math.round((5000 + 9000 + 3000) / 3));
    expect(d14.fallbackRate).toBeCloseTo(1 / 3, 10);
    expect(d14.byKind).toEqual({ analyze: 2, deepen: 1 });
  });

  it("全体 totals を出す", () => {
    const rep = aggregateByDay(entries);
    expect(rep.totals.count).toBe(4);
    expect(rep.totals.totalCost).toBeCloseTo(0.0045, 10);
    expect(rep.totals.fallbackRate).toBeCloseTo(0.25, 10);
  });

  it("ms 欠落は平均から除外(全欠落なら null)", () => {
    const rep = aggregateByDay([
      { day: "20260714", record: r(0.001, false, undefined, "analyze") },
      { day: "20260714", record: r(0.001, false, undefined, "analyze") },
    ]);
    expect(rep.rows[0].avgMs).toBeNull();
  });

  it("空入力は空 rows と 0 totals", () => {
    const rep = aggregateByDay([]);
    expect(rep.rows).toEqual([]);
    expect(rep.totals).toEqual({ count: 0, totalCost: 0, avgMs: null, fallbackRate: 0 });
  });
});

describe("formatReport", () => {
  it("表に日付・件数・合計行が含まれる", () => {
    const rep = aggregateByDay([
      { day: "20260714", record: r(0.001, false, 5000, "analyze") },
    ]);
    const out = formatReport(rep);
    expect(out).toContain("2026-07-14");
    expect(out).toContain("合計");
    expect(out).toContain("$0.00100");
    expect(out).toContain("analyze:1");
  });
});
