// 共通型定義

import type { ModelRole } from "./config/models.js";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

// callModel の戻り値。原価ログ1レコード分の素材を含む
export interface ModelCallResult {
  text: string;
  inTok: number;
  outTok: number;
  ms: number;
  // usage をレスポンスから取得できず文字数概算にフォールバックした場合 true
  estimated: boolean;
}

// 原価ログ1レコード (docs/00_architecture.md §8 の calls[] 要素)
export interface CostCallRecord {
  role: ModelRole;
  model: string;
  inTok: number;
  outTok: number;
  estCost: number;
  ms: number;
  estimated: boolean;
}

// callModel が呼び出しごとに原価ログを書き込む先。
// リクエスト単位の CostCollector が実装する (絶対ルール5)。
export interface CostSink {
  record(rec: CostCallRecord): void;
}

// ---- 深化アーキテクチャ (P1.5, docs/01_depth_design.md) ----

// プラン: light=無料(2軸4腕) / deep=有料(4軸8腕)
export type Plan = "light" | "deep";

// ドメイン(相談の領域)。Routerが分類し、light時の軸選択に使う。
export type Domain = "love" | "work" | "money" | "family" | "self" | "general";

// ノードの意見(opinions形式, §4.1)。points/confidence から移行。
export interface Opinion {
  claim: string; // 60字以内の意見
  weight: number; // 0〜1 の確信度
  why: string; // 60字以内の理由
}

// 統合脳が検出した最緊張軸 (§5 手順8)
export interface Tension {
  axis: string; // 軸ラベル (例: "心の軸")
  reason: string;
}

export type NodeStatus = "ok" | "timeout" | "parse_error" | "error" | "skipped";
export type NodeFlag = null | "insufficient_input" | "off_topic";

export interface NodeResult {
  id: string;
  status: NodeStatus;
  opinions: Opinion[];
  flag: NodeFlag;
}

// Workers バインディング。wrangler.toml と対応
export interface Env {
  OCTO_KV: KVNamespace;
  ENVIRONMENT?: string;
  ALLOWED_ORIGIN?: string;
  // APIキー等のシークレットは keyEnv 経由で動的参照する (Record<string, string>)
  [key: string]: unknown;
}
