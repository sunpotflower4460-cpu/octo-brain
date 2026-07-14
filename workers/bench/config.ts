// ============================================================================
// ベンチ設定。P3 の比較で使うモデルIDはこのファイルで設定する (P3指示)。
//
// 【実装者へ】以下の `model` は "SET_ME" プレースホルダー。実行前に実値を設定すること:
//   - BENCH_SINGLE : 比較対象「単発上位モデル」(B側)。OctoBrainより上位/高価な単発モデル
//   - BENCH_EVAL   : 評価者。A(OctoBrain)にもB(単発)にも使っていない別系統のモデル (バイアス回避)
// 単価 (pricePerMTokIn/Out, USD) も併記すること。
//
// OctoBrain 側(A)は workers dev サーバーの POST /api/analyze を叩くため、
// A側のモデル設定は workers/src/config/models.ts が使われる (ここでは設定しない)。
// ============================================================================

import type { ModelConfig } from "../src/config/models.js";

// A(OctoBrain)を叩くローカル workers dev のベースURL
export const API_BASE = process.env.BENCH_API_BASE ?? "http://localhost:8787";

// ブラインド提示順のシード (再現性のため固定)。ログに出す。
export const BLIND_SEED = 20260707;

// 直列実行時の各リクエスト間ウェイト(ms)。レート制限対策。
export const REQUEST_WAIT_MS = Number(process.env.BENCH_WAIT_MS ?? 500);

// モック実行 (実APIキー無しでハーネス全体を検証・results.md生成する)。
// 本番ベンチでは未設定 (=実モデル呼び出し)。
export const MOCK = process.env.BENCH_MOCK === "1";

// B: 単発上位モデル (OctoBrainより上位の単発モデルを想定)
export const BENCH_SINGLE: ModelConfig = {
  provider: "openai-compat",
  baseURL: "SET_ME",
  model: "SET_ME",
  maxTokens: 1200,
  keyEnv: "BENCH_SINGLE_API_KEY",
  pricePerMTokIn: 0,
  pricePerMTokOut: 0,
};

// 評価者: A・B いずれとも別系統のモデル
export const BENCH_EVAL: ModelConfig = {
  provider: "openai-compat",
  baseURL: "SET_ME",
  model: "SET_ME",
  maxTokens: 700,
  keyEnv: "BENCH_EVAL_API_KEY",
  pricePerMTokIn: 0,
  pricePerMTokOut: 0,
};

export interface Question {
  id: number;
  cat: string;
  q: string;
}

// ルーブリック項目 (各1〜5点)
export const RUBRIC_KEYS = [
  "depth", // 深さ
  "perspective", // 多角性
  "practicality", // 実用性
  "accuracy", // 正確さ
  "conciseness", // 簡潔さ
  "specificity", // 刺さり(P4追加): その人固有の状況に踏み込み一般論で終わらない度合い
] as const;

export type RubricKey = (typeof RUBRIC_KEYS)[number];

export const RUBRIC_LABEL: Record<RubricKey, string> = {
  depth: "深さ",
  perspective: "多角性",
  practicality: "実用性",
  accuracy: "正確さ",
  conciseness: "簡潔さ",
  specificity: "刺さり",
};

// 評価者への各項目の定義(採点基準を一定にする)。
export const RUBRIC_DEF: Record<RubricKey, string> = {
  depth: "表層で終わらず、前提や背景まで掘り下げているか",
  perspective: "複数の異なる角度から捉えているか",
  practicality: "次の具体的な行動につながるか",
  accuracy: "事実関係・論理に誤りがないか",
  conciseness: "冗長でなく要点が締まっているか",
  specificity: "その人固有の状況・言葉に踏み込み、一般論で終わっていないか(高いほど刺さる)",
};

// 境界問題 (負けてよい。限界を正直に認めるかを見る)
export const BOUNDARY_IDS = [19, 20];
