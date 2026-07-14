// 共鳴(掛け算)= 結合から生む (docs/phases/P1.6_resonance.md §4)。
// 一見遠い2つの opinion を掛け合わせ、第三の選択肢を生む(bisociation)。
// AIが提案したペアでも、ユーザーが自分で選んだ2つでも、同じ形で受ける。
// 1コール(synth=Pro)。全コールは callModel 経由・costlog を通す(絶対ルール5)。

import { callModel } from "./callModel.js";
import { isNodeId } from "../config/nodes.js";
import { CostCollector, logCost } from "./costlog.js";
import type { Env, ResonancePair } from "../types.js";

const CLAIM_MAX_LEN = 120;
const RESONATE_MAX_TOKENS = 800;

export interface ResonateInput {
  input: string;
  summary: string;
  resonance: { a: ResonancePair; b: ResonancePair };
  priorAnswer: string;
  clientId: string;
}

export interface ResonateDeps {
  env: Env;
  now: Date;
  requestId: string;
  signal?: AbortSignal; // P5: 全体タイムアウト予算
}

export interface ResonateResponse {
  answer: string;
  meta: {
    pair: { a: ResonancePair; b: ResonancePair };
    calls: number;
    totalCost: number;
    ms: number;
  };
}

// バリデーション結果。index.ts の 400 応答に使う。
export type ValidatedResonance =
  | { ok: true; a: ResonancePair; b: ResonancePair }
  | { ok: false; error: string };

// lens は実在NodeId、claim は各120字以内、a と b が同一lensなら不可 (§4)。
export function validateResonancePair(raw: unknown): ValidatedResonance {
  const r = (raw ?? {}) as Record<string, unknown>;
  const a = pairOf(r.a);
  const b = pairOf(r.b);
  if (a === null || b === null) return { ok: false, error: "invalid_lens" };
  if (a.claimTooLong || b.claimTooLong) return { ok: false, error: "claim_too_long" };
  if (a.pair.lens === b.pair.lens) return { ok: false, error: "same_lens" };
  return { ok: true, a: a.pair, b: b.pair };
}

function pairOf(
  v: unknown,
): { pair: ResonancePair; claimTooLong: boolean } | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!isNodeId(o.lens)) return null;
  const claim = typeof o.claim === "string" ? o.claim : "";
  if (claim.trim().length === 0) return null;
  return {
    pair: { lens: o.lens, claim: claim.trim() },
    claimTooLong: claim.length > CLAIM_MAX_LEN,
  };
}

// §4 の掛け算プロンプト(固定文)。変動情報は user 側。
const RESONATE_SYSTEM = `あなたはOctoBrainの中央脳。ユーザーの状況に対し、2本の腕が出した一見遠い2つの意見を掛け合わせる。手順:
1. 2つに共通する根をひとつ言い当てる
2. 組み合わせて生まれる第三の選択肢を具体的に描く(どちらか一方では出ない案であること)
3. それがこの人の状況で明日どう見えるか、最小の一歩に落とす
- こじつけない。根が繋がらない場合は正直に「この2つは独立している」と述べ、それぞれを別々に活かす形を短く示す
- 一般論禁止。この人の言葉に接地させる`;

export async function runResonate(
  req: ResonateInput,
  deps: ResonateDeps,
): Promise<ResonateResponse> {
  const started = deps.now.getTime();
  const collector = new CostCollector();

  const parts: string[] = [];
  if (req.summary.trim().length > 0) parts.push(`[会話要約]\n${req.summary.trim()}`);
  parts.push(`[今回の入力]\n${req.input}`);
  if (req.priorAnswer.trim().length > 0) {
    parts.push(`[以前の回答]\n${req.priorAnswer}`);
  }
  parts.push(
    `[掛け合わせる2つの意見]\n` +
      `A(${req.resonance.a.lens}): ${req.resonance.a.claim}\n` +
      `B(${req.resonance.b.lens}): ${req.resonance.b.claim}`,
  );

  const res = await callModel(
    "synth",
    [
      { role: "system", content: RESONATE_SYSTEM },
      { role: "user", content: parts.join("\n\n") },
    ],
    { env: deps.env, collector, maxTokens: RESONATE_MAX_TOKENS, signal: deps.signal },
  );

  try {
    await logCost(
      deps.env.OCTO_KV,
      deps.requestId,
      collector,
      { quorum: "resonate", fallback: false, ms: Date.now() - started, kind: "resonate" },
      deps.now,
    );
  } catch {
    // KV書き込み失敗は非致命(回答は返す)
  }

  return {
    answer: res.text.trim(),
    meta: {
      pair: { a: req.resonance.a, b: req.resonance.b },
      calls: collector.calls.length,
      totalCost: collector.totalCost(),
      ms: Date.now() - started,
    },
  };
}
