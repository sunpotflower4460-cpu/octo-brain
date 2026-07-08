// 集計スクリプト: raw + eval を読み、比較表を bench/results.md に生成する。

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fileExists,
  isMain,
  loadQuestions,
  rawPath,
  readJson,
  type EvalResult,
  type SideAResult,
  type SideBResult,
} from "./lib.js";
import {
  BOUNDARY_IDS,
  RUBRIC_KEYS,
  RUBRIC_LABEL,
  type Question,
  type RubricKey,
} from "./config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = join(HERE, "results.md");

interface Row {
  q: Question;
  a: SideAResult;
  b: SideBResult;
  e: EvalResult;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

export async function report(): Promise<void> {
  const questions = await loadQuestions();
  const rows: Row[] = [];
  const missing: number[] = [];

  for (const q of questions) {
    const aP = rawPath(`${q.id}_a.json`);
    const bP = rawPath(`${q.id}_b.json`);
    const eP = rawPath(`eval_${q.id}.json`);
    if (!(await fileExists(aP)) || !(await fileExists(bP)) || !(await fileExists(eP))) {
      missing.push(q.id);
      continue;
    }
    rows.push({
      q,
      a: await readJson<SideAResult>(aP),
      b: await readJson<SideBResult>(bP),
      e: await readJson<EvalResult>(eP),
    });
  }

  if (rows.length === 0) {
    throw new Error("集計対象の raw がありません。先に run/evaluate を実行してください。");
  }

  const isMock = rows.some((r) => r.b.model === "mock-single");

  // 総合
  const qualA = mean(rows.map((r) => r.e.totals.a));
  const qualB = mean(rows.map((r) => r.e.totals.b));
  const costA = mean(rows.map((r) => r.a.totalCost));
  const costB = mean(rows.map((r) => r.b.totalCost));
  const latA = mean(rows.map((r) => r.a.ms));
  const latB = mean(rows.map((r) => r.b.ms));
  const winA = rows.filter((r) => r.e.winner === "a").length;
  const winB = rows.filter((r) => r.e.winner === "b").length;
  const ties = rows.filter((r) => r.e.winner === "tie").length;

  // カテゴリ別品質
  const cats = [...new Set(questions.map((q) => q.cat))];
  const catRows = cats.map((cat) => {
    const rs = rows.filter((r) => r.q.cat === cat);
    return {
      cat,
      a: mean(rs.map((r) => r.e.totals.a)),
      b: mean(rs.map((r) => r.e.totals.b)),
      n: rs.length,
    };
  });

  // ルーブリック項目別平均 (/5)
  const rubricRows = RUBRIC_KEYS.map((k: RubricKey) => ({
    key: k,
    label: RUBRIC_LABEL[k],
    a: mean(rows.map((r) => r.e.scores.a[k])),
    b: mean(rows.map((r) => r.e.scores.b[k])),
  }));

  const costRatio = costA > 0 && costB > 0 ? costB / costA : 0; // 単発は OctoBrain の何倍か
  const qualityPct = qualB > 0 ? (qualA / qualB) * 100 : 0;

  const md = buildMarkdown({
    isMock,
    n: rows.length,
    missing,
    total: { qualA, qualB, costA, costB, latA, latB, winA, winB, ties },
    catRows,
    rubricRows,
    boundary: rows.filter((r) => BOUNDARY_IDS.includes(r.q.id)),
    costRatio,
    qualityPct,
  });

  await writeFile(RESULTS_PATH, md, "utf8");
  console.log(`[report] ${RESULTS_PATH} を生成 (${rows.length}問, mock=${isMock})`);
  if (missing.length) console.log(`[report] 欠損: ${missing.join(", ")}`);
}

interface MdInput {
  isMock: boolean;
  n: number;
  missing: number[];
  total: {
    qualA: number;
    qualB: number;
    costA: number;
    costB: number;
    latA: number;
    latB: number;
    winA: number;
    winB: number;
    ties: number;
  };
  catRows: { cat: string; a: number; b: number; n: number }[];
  rubricRows: { key: string; label: string; a: number; b: number }[];
  boundary: Row[];
  costRatio: number;
  qualityPct: number;
}

function f2(n: number): string {
  return n.toFixed(2);
}
function usd(n: number): string {
  return "$" + n.toFixed(5);
}
function ms(n: number): string {
  return Math.round(n) + "ms";
}

function buildMarkdown(d: MdInput): string {
  const t = d.total;
  const lines: string[] = [];

  lines.push("# P3 ベンチ結果 — 「安いのに深い」を数字にする");
  lines.push("");
  lines.push(
    `20問の共通質問に対する **OctoBrain**(8ノード統合, mode=complex)と **単発上位モデル** の比較。`,
  );
  lines.push(
    `評価は A・B いずれにも使っていない別系統モデルによるブラインド相対採点(提示順シード固定・ログ出力)。`,
  );
  lines.push("");
  if (d.isMock) {
    lines.push(
      "> ⚠️ **これはモックラン(`BENCH_MOCK=1`)で生成したサンプル出力です。**",
    );
    lines.push(
      "> 実APIキー未設定の環境でハーネスの動作確認と表フォーマット検証のために生成しました。",
    );
    lines.push(
      "> 実データは `bench/config.ts` にモデル/キーを設定し `npm run bench` で再生成してください。",
    );
    lines.push("");
  }
  lines.push(`- 集計対象: ${d.n}問` + (d.missing.length ? ` (欠損: ${d.missing.join(", ")})` : ""));
  lines.push("");

  // メイン表
  lines.push("## 総合比較");
  lines.push("");
  lines.push("| 指標 | OctoBrain | 単発上位 |");
  lines.push("|---|---|---|");
  lines.push(`| 品質スコア平均(総合, /25) | ${f2(t.qualA)} | ${f2(t.qualB)} |`);
  lines.push(`| 1回答あたり平均コスト(USD) | ${usd(t.costA)} | ${usd(t.costB)} |`);
  lines.push(`| 平均レイテンシ | ${ms(t.latA)} | ${ms(t.latB)} |`);
  lines.push(`| 勝敗数(問別の総合点比較) | ${t.winA}勝 | ${t.winB}勝 (引分 ${t.ties}) |`);
  lines.push("");

  // カテゴリ別品質
  lines.push("## カテゴリ別 品質スコア平均 (/25)");
  lines.push("");
  lines.push("| カテゴリ | OctoBrain | 単発上位 | 差 |");
  lines.push("|---|---|---|---|");
  for (const c of d.catRows) {
    const diff = c.a - c.b;
    const sign = diff >= 0 ? "+" : "";
    lines.push(`| ${c.cat} (${c.n}問) | ${f2(c.a)} | ${f2(c.b)} | ${sign}${f2(diff)} |`);
  }
  lines.push("");

  // ルーブリック別
  lines.push("## ルーブリック項目別 平均 (/5)");
  lines.push("");
  lines.push("| 項目 | OctoBrain | 単発上位 |");
  lines.push("|---|---|---|");
  for (const r of d.rubricRows) {
    lines.push(`| ${r.label} | ${f2(r.a)} | ${f2(r.b)} |`);
  }
  lines.push("");

  // 境界問題
  lines.push("## 境界問題の挙動 (19, 20 — 負けてよい問題)");
  lines.push("");
  lines.push(
    "数学・最新情報での限界が正直に出るか(誤魔化さず「わからない」と言えるか)を見る。",
  );
  lines.push("");
  lines.push("| id | 質問 | OctoBrain 正直 | 単発 正直 | 勝者 |");
  lines.push("|---|---|---|---|---|");
  for (const r of d.boundary) {
    const honest = r.e.boundary;
    lines.push(
      `| ${r.q.id} | ${r.q.q.slice(0, 24)}… | ${honest ? (honest.a ? "○" : "×") : "-"} | ${honest ? (honest.b ? "○" : "×") : "-"} | ${r.e.winner.toUpperCase()} |`,
    );
  }
  lines.push("");

  // サマリ
  lines.push("## サマリ");
  lines.push("");
  const costFrac = d.costRatio >= 1 ? `約1/${Math.round(d.costRatio)}` : `${f2(d.costRatio)}倍`;
  lines.push(
    `- **コスト ${costFrac}(単発比)で、品質 ${Math.round(d.qualityPct)}%** を達成。`,
  );
  lines.push(
    `- 勝敗: OctoBrain ${t.winA}勝 / 単発 ${t.winB}勝 / 引分 ${t.ties}。`,
  );
  lines.push(
    `- 単発1回あたり ${usd(t.costB)} に対し OctoBrain は ${usd(t.costA)}。レイテンシは OctoBrain ${ms(t.latA)} vs 単発 ${ms(t.latB)}(並列ノード+統合のため単発より時間はかかる)。`,
  );
  lines.push("");

  return lines.join("\n") + "\n";
}

if (isMain(import.meta.url)) {
  report().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
