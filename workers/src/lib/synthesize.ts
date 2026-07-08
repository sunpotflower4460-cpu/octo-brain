// Synthesizer = 中央脳 (docs/01_depth_design.md §5)。
// 「まとめ」から「掘り」へ。8本の腕 = 4つの対角軸の報告を一つの深い理解に織り上げ、
// 最緊張軸を ---TENSION--- で、更新版要約を ---SUMMARY--- で機械可読に出力する。
// マーカー順: 本文 → ---TENSION--- → ---SUMMARY---

import { callModel } from "./callModel.js";
import { callModelStream } from "./callModelStream.js";
import { axisLabel, nodeDef, type NodeId, type Square } from "../config/nodes.js";
import type { CostSink, Env, NodeResult, Opinion, Tension } from "../types.js";

const TENSION_MARKER = "---TENSION---";
const SUMMARY_MARKER = "---SUMMARY---";
const SUMMARY_MAX_LEN = 300;
const CONFIDENCE_FLOOR = 0.4;

// §5 の「掘る版」手順(固定文)。
const SYNTH_PROCEDURE = `あなたはOctoBrainの中央脳。8本の腕 — 4つの対角軸 — からの報告を、一つの深い理解に織り上げる。手順:
1. ユーザーの入力から最も重みのある一文をそのまま引用し、そこから回答を始める
2. 4つの軸(時/心/動/魂)それぞれで、対角の2報告が張り合っていないか見る
3. 最も張り詰めた軸をひとつ特定する。その緊張は、本人が迫られている本当の選択を指している — それを本人の言葉で言語化する
4. 一般論を書いたら削除する。この人の状況にしか当てはまらない文だけを残す
5. weight<0.4のopinionは参考扱い、flagが立っている報告は除外する
6. 構成: 引用から始まる導入 → 織り上げた理解(軸の緊張を含む) → 見方が分かれる点(残る場合のみ) → 次の一歩
7. 最後に、本人がまだ言葉にしていない問いをひとつだけ置く
- 腕のIDや「ノード3によると」のような機械的引用は禁止。自然な文章に溶かす
- 断定は根拠の強さに比例させる`;

// フォールバック時 (クォーラム未達): ノード補助なしで単発直接回答。
const FALLBACK_PROCEDURE = `あなたはOctoBrainの中央脳です。分析腕の補助が得られなかったため、以下の入力にあなた自身の判断で誠実かつ具体的に直接回答せよ。一般論を避け、この人の状況に踏み込む。過剰な断定を避け、根拠の強さに応じた言い方をする。`;

// TENSION + SUMMARY 出力指示(固定文)。
const TENSION_SUMMARY_DIRECTIVE = `回答本文を出力し終えたら、次の2つの機械可読ブロックをこの順で必ず付ける(本文・要約には混ぜない):
まず "${TENSION_MARKER}" を置き、同じ行に {"axis":"時の軸|心の軸|動の軸|魂の軸 のいずれか","reason":"なぜその軸が最も張り詰めているかを一文で"} を出力する。
続けて "${SUMMARY_MARKER}" を単独行で置き、その後に今回のやり取りを踏まえた${SUMMARY_MAX_LEN}字以内の更新版会話要約のみを出力する(見出し・前置き・箇条書き記号は付けない)。`;

// フォールバックは軸が無いので TENSION は出さず SUMMARY のみ。
const SUMMARY_ONLY_DIRECTIVE = `回答本文を出力し終えたら、"${SUMMARY_MARKER}" を単独行で置き、その後に今回のやり取りを踏まえた${SUMMARY_MAX_LEN}字以内の更新版会話要約のみを出力する(見出し・前置き・記号なし)。`;

const SYNTH_SYSTEM = `${SYNTH_PROCEDURE}\n\n${TENSION_SUMMARY_DIRECTIVE}`;
const FALLBACK_SYSTEM = `${FALLBACK_PROCEDURE}\n\n${SUMMARY_ONLY_DIRECTIVE}`;

export interface SynthOpts {
  env: Env;
  collector?: CostSink;
  signal?: AbortSignal;
}

export interface SynthResult {
  answer: string;
  summary: string;
  tension: Tension | null;
}

// 中央脳に渡すレンズ報告。除外規則を適用済みの形。軸情報を含める(緊張検出のため)。
export interface SynthReport {
  lens: string; // uiName
  axis: string; // 軸ラベル
  square: Square;
  opinions: Opinion[];
}

// §5 除外ルール: flag付き / opinions空 / 非ok は除外。weight<0.4 は本文側で参考扱い。
export function buildReports(nodes: NodeResult[]): SynthReport[] {
  return nodes
    .filter((n) => n.status === "ok" && n.flag === null && n.opinions.length > 0)
    .map((n) => {
      const d = nodeDef(n.id as NodeId);
      return {
        lens: d.uiName,
        axis: axisLabel(d.axis),
        square: d.square,
        opinions: n.opinions,
      };
    });
}

// weight<0.4 の opinion だけを含むかどうか(テスト・可視化補助)。
export function hasPrimarySignal(report: SynthReport): boolean {
  return report.opinions.some((o) => o.weight >= CONFIDENCE_FLOOR);
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
  return splitAnswerTensionSummary(res.text, summary);
}

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
  return splitAnswerTensionSummary(res.text, summary);
}

// user側: [会話要約(あれば)] + [今回の入力] + [軸ごとの報告(対角2腕の対話)] (§5)
export function buildSynthUserText(
  input: string,
  summary: string,
  reports: SynthReport[],
): string {
  const byAxis = new Map<string, SynthReport[]>();
  for (const r of reports) {
    const arr = byAxis.get(r.axis) ?? [];
    arr.push(r);
    byAxis.set(r.axis, arr);
  }
  const dialogues = [...byAxis.entries()].map(([axis, rs]) => ({
    axis,
    lenses: rs.map((r) => ({ lens: r.lens, opinions: r.opinions })),
  }));

  const parts: string[] = [];
  if (summary.trim().length > 0) parts.push(`[会話要約]\n${summary.trim()}`);
  parts.push(`[今回の入力]\n${input}`);
  parts.push(
    `[軸ごとの報告(対角の2腕が張り合う)]\n${JSON.stringify(dialogues)}`,
  );
  return parts.join("\n\n");
}

function buildFallbackUserText(input: string, summary: string): string {
  const parts: string[] = [];
  if (summary.trim().length > 0) parts.push(`[会話要約]\n${summary.trim()}`);
  parts.push(`[今回の入力]\n${input}`);
  return parts.join("\n\n");
}

// 本文 / TENSION / SUMMARY を分離(一括版)。マーカー欠落は非致命。
export function splitAnswerTensionSummary(
  text: string,
  oldSummary: string,
): SynthResult {
  const tIdx = text.indexOf(TENSION_MARKER);
  const sIdx = text.indexOf(SUMMARY_MARKER);

  let answerEnd = text.length;
  if (tIdx !== -1) answerEnd = Math.min(answerEnd, tIdx);
  if (sIdx !== -1) answerEnd = Math.min(answerEnd, sIdx);
  const answer = text.slice(0, answerEnd).trim();

  let tension: Tension | null = null;
  if (tIdx !== -1) {
    const tEnd = sIdx !== -1 && sIdx > tIdx ? sIdx : text.length;
    tension = parseTension(text.slice(tIdx + TENSION_MARKER.length, tEnd));
  }

  let summary = oldSummary;
  if (sIdx !== -1) {
    const raw = text.slice(sIdx + SUMMARY_MARKER.length).trim();
    if (raw.length > 0) summary = raw.slice(0, SUMMARY_MAX_LEN);
  }

  return { answer, summary, tension };
}

// TENSION行の {...} を抽出してパース。失敗は null(非致命)。
function parseTension(raw: string): Tension | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const axis = typeof obj.axis === "string" ? obj.axis.trim() : "";
    if (axis.length === 0) return null;
    const reason = typeof obj.reason === "string" ? obj.reason : "";
    return { axis, reason };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ストリーミング: 本文だけを逐次 emit し、TENSION/SUMMARY 以降は流さない。
// マーカーがチャンク分割をまたいでも漏れないよう末尾を保持する。
// ---------------------------------------------------------------------------
export class DepthStreamCutter {
  static readonly MARKERS = [TENSION_MARKER, SUMMARY_MARKER];
  private static readonly HOLD =
    Math.max(TENSION_MARKER.length, SUMMARY_MARKER.length) - 1;

  private full = "";
  private emitted = 0;
  private stopped = false;

  push(delta: string): string {
    this.full += delta;
    if (this.stopped) return "";

    const idx = firstMarkerIndex(this.full);
    if (idx !== -1) {
      this.stopped = true;
      const out = this.full.slice(this.emitted, idx);
      this.emitted = idx;
      return out;
    }
    const safeEnd = this.full.length - DepthStreamCutter.HOLD;
    if (safeEnd <= this.emitted) return "";
    const out = this.full.slice(this.emitted, safeEnd);
    this.emitted = safeEnd;
    return out;
  }

  flushRemaining(): string {
    const idx = firstMarkerIndex(this.full);
    const answerEnd = idx === -1 ? this.full.length : idx;
    if (answerEnd <= this.emitted) return "";
    const out = this.full.slice(this.emitted, answerEnd);
    this.emitted = answerEnd;
    return out;
  }

  result(oldSummary: string): SynthResult {
    return splitAnswerTensionSummary(this.full, oldSummary);
  }
}

function firstMarkerIndex(s: string): number {
  let idx = -1;
  for (const m of DepthStreamCutter.MARKERS) {
    const i = s.indexOf(m);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  return idx;
}

export async function synthesizeStream(
  input: string,
  summary: string,
  nodes: NodeResult[],
  opts: SynthOpts,
  onToken: (t: string) => void,
): Promise<SynthResult> {
  const reports = buildReports(nodes);
  const userText = buildSynthUserText(input, summary, reports);
  return streamAndCut(SYNTH_SYSTEM, userText, summary, opts, onToken);
}

export async function synthesizeFallbackStream(
  input: string,
  summary: string,
  opts: SynthOpts,
  onToken: (t: string) => void,
): Promise<SynthResult> {
  const userText = buildFallbackUserText(input, summary);
  return streamAndCut(FALLBACK_SYSTEM, userText, summary, opts, onToken);
}

async function streamAndCut(
  system: string,
  userText: string,
  oldSummary: string,
  opts: SynthOpts,
  onToken: (t: string) => void,
): Promise<SynthResult> {
  const cutter = new DepthStreamCutter();
  for await (const delta of callModelStream(
    "synth",
    [
      { role: "system", content: system },
      { role: "user", content: userText },
    ],
    { env: opts.env, collector: opts.collector, signal: opts.signal },
  )) {
    const out = cutter.push(delta);
    if (out.length > 0) onToken(out);
  }
  const tail = cutter.flushRemaining();
  if (tail.length > 0) onToken(tail);
  return cutter.result(oldSummary);
}
