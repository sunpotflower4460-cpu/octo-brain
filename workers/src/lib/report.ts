// P5 運用レポート: KV の原価ログ(cost:{yyyymmdd}:{requestId})を日次集計する純関数。
// KV アクセス(wrangler)は ops/report.ts が担い、ここは集計・整形のみ(テスト可能)。

import type { StoredCostRecord } from "./costlog.js";

export interface DayEntry {
  day: string; // "YYYYMMDD"
  record: StoredCostRecord;
}

export interface DailyRow {
  day: string;
  count: number;
  totalCost: number;
  avgMs: number | null;
  fallbackRate: number; // 0..1 (部分失敗=fallback の割合)
  byKind: Record<string, number>;
}

export interface Report {
  rows: DailyRow[];
  totals: {
    count: number;
    totalCost: number;
    avgMs: number | null;
    fallbackRate: number;
  };
}

// 日ごとに集計。day 昇順で返す。
export function aggregateByDay(entries: DayEntry[]): Report {
  const byDay = new Map<string, DayEntry[]>();
  for (const e of entries) {
    const arr = byDay.get(e.day) ?? [];
    arr.push(e);
    byDay.set(e.day, arr);
  }

  const rows: DailyRow[] = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([day, es]) => summarize(day, es.map((e) => e.record)));

  const allRecords = entries.map((e) => e.record);
  const totalsRow = summarize("__all__", allRecords);

  return {
    rows,
    totals: {
      count: totalsRow.count,
      totalCost: totalsRow.totalCost,
      avgMs: totalsRow.avgMs,
      fallbackRate: totalsRow.fallbackRate,
    },
  };
}

function summarize(day: string, records: StoredCostRecord[]): DailyRow {
  const count = records.length;
  let totalCost = 0;
  let fallbacks = 0;
  let msSum = 0;
  let msCount = 0;
  const byKind: Record<string, number> = {};

  for (const r of records) {
    totalCost += Number.isFinite(r.totalCost) ? r.totalCost : 0;
    if (r.fallback) fallbacks += 1;
    if (typeof r.ms === "number" && Number.isFinite(r.ms)) {
      msSum += r.ms;
      msCount += 1;
    }
    const kind = r.kind ?? "unknown";
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }

  return {
    day,
    count,
    totalCost,
    avgMs: msCount > 0 ? Math.round(msSum / msCount) : null,
    fallbackRate: count > 0 ? fallbacks / count : 0,
    byKind,
  };
}

// cost キー "cost:YYYYMMDD:reqid" から日付を取り出す。合わなければ null。
export function dayFromCostKey(key: string): string | null {
  const m = /^cost:(\d{8}):/.exec(key);
  return m ? m[1] : null;
}

// 人間向けの表を作る(等幅・ASCII罫線)。
export function formatReport(report: Report): string {
  const money = (n: number) => `$${n.toFixed(5)}`;
  const ms = (n: number | null) => (n === null ? "—" : `${n}ms`);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const kinds = (r: Record<string, number>) =>
    Object.entries(r)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join(" ");

  const header = ["日付", "件数", "総コスト", "平均ms", "fallback率", "内訳"];
  const lines = report.rows.map((r) => [
    fmtDay(r.day),
    String(r.count),
    money(r.totalCost),
    ms(r.avgMs),
    pct(r.fallbackRate),
    kinds(r.byKind),
  ]);
  const totalLine = [
    "合計",
    String(report.totals.count),
    money(report.totals.totalCost),
    ms(report.totals.avgMs),
    pct(report.totals.fallbackRate),
    "",
  ];

  const all = [header, ...lines, totalLine];
  const widths = header.map((_, i) =>
    Math.max(...all.map((row) => displayWidth(row[i]))),
  );
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - displayWidth(s)));
  const renderRow = (row: string[]) => row.map((cell, i) => pad(cell, widths[i])).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");

  return [
    renderRow(header),
    sep,
    ...lines.map(renderRow),
    sep,
    renderRow(totalLine),
  ].join("\n");
}

function fmtDay(day: string): string {
  if (day.length !== 8) return day;
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
}

// 全角(CJK)を2幅として概算する簡易幅計算。
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch)
      ? 2
      : 1;
  }
  return w;
}
