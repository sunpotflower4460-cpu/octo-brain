// P5 運用スクリプト: 日次の原価・失敗率・平均レイテンシを表で出す。
//
//   npm run ops:report                 # 当日(UTC)の集計
//   npm run ops:report -- --days 7     # 直近7日
//   npm run ops:report -- --json       # 機械可読(JSON)
//   npm run ops:report -- --input f.json  # KVの代わりにローカルJSONから集計(検証用)
//   npm run ops:report -- --remote     # 本番KV(既定はプレビュー/ローカル)
//
// KV からの取得は wrangler CLI を経由する(認証・バインディングは wrangler.toml)。
// 集計・整形ロジックは src/lib/report.ts(純関数・テスト済み)。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  aggregateByDay,
  formatReport,
  dayFromCostKey,
  type DayEntry,
} from "../src/lib/report.js";
import type { StoredCostRecord } from "../src/lib/costlog.js";

interface Args {
  days: number;
  json: boolean;
  input: string | null;
  remote: boolean;
  binding: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { days: 1, json: false, input: null, remote: false, binding: "OCTO_KV" };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--days") a.days = Math.max(1, parseInt(argv[++i] ?? "1", 10) || 1);
    else if (t === "--json") a.json = true;
    else if (t === "--input") a.input = argv[++i] ?? null;
    else if (t === "--remote") a.remote = true;
    else if (t === "--binding") a.binding = argv[++i] ?? "OCTO_KV";
  }
  return a;
}

function yyyymmdd(d: Date): string {
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

function targetDays(n: number): string[] {
  const out: string[] = [];
  const base = Date.now();
  for (let i = 0; i < n; i++) {
    out.push(yyyymmdd(new Date(base - i * 86_400_000)));
  }
  return out;
}

// --input: DayEntry[] / StoredCostRecord[] / {key,value}[] のいずれかを受ける。
function loadFromFile(path: string): DayEntry[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error("input must be a JSON array");
  const entries: DayEntry[] = [];
  for (const item of parsed as Record<string, unknown>[]) {
    if (item && typeof item.day === "string" && item.record) {
      entries.push({ day: item.day, record: item.record as StoredCostRecord });
    } else if (item && typeof item.key === "string" && item.value) {
      const day = dayFromCostKey(item.key) ?? "unknown";
      const record =
        typeof item.value === "string"
          ? (JSON.parse(item.value) as StoredCostRecord)
          : (item.value as StoredCostRecord);
      entries.push({ day, record });
    } else {
      // 素の StoredCostRecord(日付不明)
      entries.push({ day: "unknown", record: item as unknown as StoredCostRecord });
    }
  }
  return entries;
}

function wrangler(args: string[]): string {
  return execFileSync("npx", ["wrangler", ...args], { encoding: "utf8" });
}

// wrangler 経由で cost:YYYYMMDD* を列挙して取得する。
function loadFromWrangler(days: string[], binding: string, remote: boolean): DayEntry[] {
  const scope = remote ? ["--remote"] : ["--preview", "false"];
  const entries: DayEntry[] = [];
  for (const day of days) {
    const listOut = wrangler([
      "kv", "key", "list",
      "--binding", binding,
      "--prefix", `cost:${day}`,
      ...scope,
    ]);
    let keys: { name: string }[] = [];
    try {
      keys = JSON.parse(listOut) as { name: string }[];
    } catch {
      keys = [];
    }
    for (const k of keys) {
      const val = wrangler(["kv", "key", "get", k.name, "--binding", binding, ...scope]);
      try {
        entries.push({ day, record: JSON.parse(val) as StoredCostRecord });
      } catch {
        /* 壊れたレコードはスキップ */
      }
    }
  }
  return entries;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const days = targetDays(args.days);

  let entries: DayEntry[];
  if (args.input) {
    entries = loadFromFile(args.input);
  } else {
    try {
      entries = loadFromWrangler(days, args.binding, args.remote);
    } catch (err) {
      console.error(
        "[ops:report] KV 取得に失敗しました。wrangler の認証/バインディングを確認してください。",
      );
      console.error(err instanceof Error ? err.message : String(err));
      console.error(
        "ローカル検証は `npm run ops:report -- --input <file.json>` を使えます。",
      );
      process.exit(1);
      return;
    }
  }

  const report = aggregateByDay(entries);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const label = args.input ? args.input : `直近${args.days}日 (${days[days.length - 1]}〜${days[0]})`;
    console.log(`OctoBrain 原価レポート — ${label}\n`);
    console.log(entries.length === 0 ? "(該当レコードなし)" : formatReport(report));
  }
}

main();
