// Synthesizer (統合脳, docs/00_architecture.md §4)。
// 手続き化プロンプトでノードレポートを統合し、最終回答 + 更新版ローリング要約を
// 1回の呼び出しで得る (回答本文の後に "---SUMMARY---" 区切り + 300字以内の要約)。

import { callModel } from "./callModel.js";
import type { CostSink, Env, NodeResult } from "../types.js";

const SUMMARY_MARKER = "---SUMMARY---";
const SUMMARY_MAX_LEN = 300;
const CONFIDENCE_FLOOR = 0.4;

// §4 の手続き化システムプロンプト (固定)。
const SYNTH_PROCEDURE = `8つ以下の分析ノードからのJSONレポートを統合し、最終回答を生成せよ。手順:
1. ノード間で対立する主張を特定する
2. confidence < 0.4 のレポートは参考情報に格下げする
3. flagが立っているレポート・pointsが空のレポートは除外する
4. 残りを統合する。対立点が残る場合は隠さず「見方が分かれる点」として明示する
5. 出力構成: 結論 → 根拠(ノードの知見を溶かし込む) → 見方が分かれる点(あれば) → 次の一手
- ノードのIDや「ノード3によると」のような機械的引用はしない。自然な文章に溶かす
- 過剰な断定を避け、根拠の強さに応じた言い方をする`;

// フォールバック時 (クォーラム未達): ノード補助なしで単発直接回答。
const FALLBACK_PROCEDURE = `あなたはOctoBrainの統合脳です。分析ノードの補助が得られなかったため、以下の入力にあなた自身の判断で誠実かつ簡潔に直接回答せよ。過剰な断定を避け、根拠の強さに応じた言い方をする。`;

// P1追記: 1回の呼び出しで回答と更新版要約を両方得るための固定指示。
const SUMMARY_DIRECTIVE = `回答本文を出力し終えたら、次の行に区切り "${SUMMARY_MARKER}" を単独で1行置き、さらにその後に今回のやり取りを踏まえた${SUMMARY_MAX_LEN}字以内の更新版会話要約のみを出力せよ。要約に見出し・前置き・箇条書き記号は付けない。`;

const SYNTH_SYSTEM = `${SYNTH_PROCEDURE}\n\n${SUMMARY_DIRECTIVE}`;
const FALLBACK_SYSTEM = `${FALLBACK_PROCEDURE}\n\n${SUMMARY_DIRECTIVE}`;

export interface SynthOpts {
  env: Env;
  collector?: CostSink;
  signal?: AbortSignal;
}

export interface SynthResult {
  answer: string;
  summary: string;
}

// 統合脳に渡すノードレポート。除外・格下げ規則を適用済みの形。
export interface SynthReport {
  points: string[];
  confidence: number;
  weight: "primary" | "reference";
}

// §4 除外/格下げルールを入力構築側で適用:
// - flag付き / points空 は除外
// - confidence < 0.4 は "reference" に格下げ (除外はしない)
export function buildReports(nodes: NodeResult[]): SynthReport[] {
  return nodes
    .filter((n) => n.status === "ok" && n.flag === null && n.points.length > 0)
    .map((n) => ({
      points: n.points,
      confidence: n.confidence,
      weight: n.confidence < CONFIDENCE_FLOOR ? "reference" : "primary",
    }));
}

export async function synthesize(
  input: string,
  summary: string,
  nodes: NodeResult[],
  opts: SynthOpts,
): Promise<SynthResult> {
  const reports = buildReports(nodes);
  const userText = buildSynthUserText(input, summary, reports);
  const res = await callModel(
    "synth",
    [
      { role: "system", content: SYNTH_SYSTEM },
      { role: "user", content: userText },
    ],
    { env: opts.env, collector: opts.collector, signal: opts.signal },
  );
  return splitAnswerAndSummary(res.text, summary);
}

// クォーラム未達時の単発フォールバック回答。
export async function synthesizeFallback(
  input: string,
  summary: string,
  opts: SynthOpts,
): Promise<SynthResult> {
  const userText = buildFallbackUserText(input, summary);
  const res = await callModel(
    "synth",
    [
      { role: "system", content: FALLBACK_SYSTEM },
      { role: "user", content: userText },
    ],
    { env: opts.env, collector: opts.collector, signal: opts.signal },
  );
  return splitAnswerAndSummary(res.text, summary);
}

// user側: [会話要約(あれば)] + [今回の入力] + [okノードのJSONレポート配列] (§4)
export function buildSynthUserText(
  input: string,
  summary: string,
  reports: SynthReport[],
): string {
  const parts: string[] = [];
  if (summary.trim().length > 0) {
    parts.push(`[会話要約]\n${summary.trim()}`);
  }
  parts.push(`[今回の入力]\n${input}`);
  parts.push(`[ノードレポート]\n${JSON.stringify(reports)}`);
  return parts.join("\n\n");
}

function buildFallbackUserText(input: string, summary: string): string {
  const parts: string[] = [];
  if (summary.trim().length > 0) {
    parts.push(`[会話要約]\n${summary.trim()}`);
  }
  parts.push(`[今回の入力]\n${input}`);
  return parts.join("\n\n");
}

// 回答本文と更新版要約を分離。マーカーが無ければ要約は旧値を維持 (§4)。
export function splitAnswerAndSummary(
  text: string,
  oldSummary: string,
): SynthResult {
  const idx = text.indexOf(SUMMARY_MARKER);
  if (idx === -1) {
    return { answer: text.trim(), summary: oldSummary };
  }
  const answer = text.slice(0, idx).trim();
  const rawSummary = text.slice(idx + SUMMARY_MARKER.length).trim();
  const summary =
    rawSummary.length > 0 ? rawSummary.slice(0, SUMMARY_MAX_LEN) : oldSummary;
  return { answer, summary };
}
