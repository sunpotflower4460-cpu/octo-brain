// Synthesizer = 中央脳 (docs/01_depth_design.md §5, P1.6 共鳴)。
// 「まとめ」から「掘り」へ。8本の腕 = 4つの対角軸の報告を一つの深い理解に織り上げ、
// 共鳴を ---RESONANCE--- で、最緊張軸を ---TENSION--- で、更新版要約を ---SUMMARY--- で
// 機械可読に出力する。マーカー順: 本文 → ---RESONANCE---(任意) → ---TENSION--- → ---SUMMARY---

import { callModel } from "./callModel.js";
import { callModelStream } from "./callModelStream.js";
import {
  axisLabel,
  isNodeId,
  nodeDef,
  type NodeId,
  type Square,
} from "../config/nodes.js";
import type {
  CostSink,
  Env,
  NodeResult,
  Opinion,
  Resonance,
  Tension,
} from "../types.js";

const RESONANCE_MARKER = "---RESONANCE---";
const TENSION_MARKER = "---TENSION---";
const SUMMARY_MARKER = "---SUMMARY---";
const SUMMARY_MAX_LEN = 300;
const CLAIM_MAX_LEN = 120;
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
8. 軸をまたいで、遠いのに響き合う opinion の組がひとつだけあれば ${RESONANCE_MARKER} 行を出す(§共鳴)。基準: (a)異なる軸に属する (b)共通の根が一文で言える (c)組み合わせると新しい選択肢が生まれる。3つすべて満たすときだけ。無理に作らない。該当が無ければ出さない
- 腕のIDや「ノード3によると」のような機械的引用は禁止。自然な文章に溶かす
- 断定は根拠の強さに比例させる`;

// フォールバック時 (クォーラム未達): ノード補助なしで単発直接回答。
const FALLBACK_PROCEDURE = `あなたはOctoBrainの中央脳です。分析腕の補助が得られなかったため、以下の入力にあなた自身の判断で誠実かつ具体的に直接回答せよ。一般論を避け、この人の状況に踏み込む。過剰な断定を避け、根拠の強さに応じた言い方をする。`;

// RESONANCE(任意)+ TENSION + SUMMARY 出力指示(固定文)。
// マーカー順を厳守: 本文 → RESONANCE(任意) → TENSION → SUMMARY。本文・要約に混ぜない。
const TENSION_SUMMARY_DIRECTIVE = `回答本文を出力し終えたら、機械可読ブロックを次の順で付ける(本文・要約には混ぜない):
1. 響き合う組がひとつだけ確実にあるときのみ "${RESONANCE_MARKER}" を置き、同じ行に {"a":{"lens":"<レンズID>","claim":"<元claimを引用>"},"b":{"lens":"<レンズID>","claim":"..."},"root":"共通の根を一文で"} を出力する(無ければこの行を省略)。lens は reason/emotion/risk/empathy/future/truth/step/values のいずれか。
2. "${TENSION_MARKER}" を置き、同じ行に {"axis":"時の軸|心の軸|動の軸|魂の軸 のいずれか","reason":"なぜその軸が最も張り詰めているかを一文で"} を出力する。
3. "${SUMMARY_MARKER}" を単独行で置き、その後に今回のやり取りを踏まえた${SUMMARY_MAX_LEN}字以内の更新版会話要約のみを出力する(見出し・前置き・箇条書き記号は付けない)。`;

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
  resonance: Resonance | null;
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

// 本文 / RESONANCE / TENSION / SUMMARY を分離(一括版)。各マーカー欠落は非致命。
// マーカー順: 本文 → RESONANCE(任意) → TENSION → SUMMARY。
export function splitAnswerTensionSummary(
  text: string,
  oldSummary: string,
): SynthResult {
  const rIdx = text.indexOf(RESONANCE_MARKER);
  const tIdx = text.indexOf(TENSION_MARKER);
  const sIdx = text.indexOf(SUMMARY_MARKER);

  // 本文は最初に現れたマーカーの手前まで
  let answerEnd = text.length;
  for (const i of [rIdx, tIdx, sIdx]) {
    if (i !== -1) answerEnd = Math.min(answerEnd, i);
  }
  const answer = text.slice(0, answerEnd).trim();

  // RESONANCE: rIdx から次のマーカー(TENSION/SUMMARY のうち rIdx より後で最小)まで
  let resonance: Resonance | null = null;
  if (rIdx !== -1) {
    resonance = parseResonance(
      text.slice(rIdx + RESONANCE_MARKER.length, nextMarkerEnd(text, rIdx, [tIdx, sIdx])),
    );
  }

  // TENSION: tIdx から次のマーカー(SUMMARY のうち tIdx より後)まで
  let tension: Tension | null = null;
  if (tIdx !== -1) {
    tension = parseTension(
      text.slice(tIdx + TENSION_MARKER.length, nextMarkerEnd(text, tIdx, [sIdx])),
    );
  }

  let summary = oldSummary;
  if (sIdx !== -1) {
    const raw = text.slice(sIdx + SUMMARY_MARKER.length).trim();
    if (raw.length > 0) summary = raw.slice(0, SUMMARY_MAX_LEN);
  }

  return { answer, summary, tension, resonance };
}

// from より後にある候補マーカー位置の最小。無ければ末尾。
function nextMarkerEnd(text: string, from: number, candidates: number[]): number {
  let end = text.length;
  for (const c of candidates) {
    if (c !== -1 && c > from) end = Math.min(end, c);
  }
  return end;
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

// RESONANCE行の {...} を抽出・検証。lens が実在NodeIdでない・同一・root欠落は null(非致命)。
function parseResonance(raw: string): Resonance | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const a = pairOf(obj.a);
    const b = pairOf(obj.b);
    const root = typeof obj.root === "string" ? obj.root.trim() : "";
    if (a === null || b === null || root.length === 0) return null;
    if (a.lens === b.lens) return null; // 同一レンズは組にならない
    return { a, b, root };
  } catch {
    return null;
  }
}

function pairOf(v: unknown): { lens: NodeId; claim: string } | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!isNodeId(o.lens)) return null;
  const claim = typeof o.claim === "string" ? o.claim.trim() : "";
  if (claim.length === 0) return null;
  return { lens: o.lens, claim: claim.slice(0, CLAIM_MAX_LEN) };
}

// ---------------------------------------------------------------------------
// ストリーミング: 本文だけを逐次 emit し、RESONANCE/TENSION/SUMMARY 以降は流さない。
// マーカーがチャンク分割をまたいでも漏れないよう末尾を保持する。
// ---------------------------------------------------------------------------
export class DepthStreamCutter {
  static readonly MARKERS = [RESONANCE_MARKER, TENSION_MARKER, SUMMARY_MARKER];
  private static readonly HOLD =
    Math.max(...DepthStreamCutter.MARKERS.map((m) => m.length)) - 1;

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
