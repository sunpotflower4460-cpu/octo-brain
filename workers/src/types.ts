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

// ---- 分析パイプライン ----

export type Route = "simple" | "normal" | "complex";
export type AnalyzeMode = "auto" | Route;

export type NodeStatus = "ok" | "timeout" | "parse_error" | "error" | "skipped";
export type NodeFlag = null | "insufficient_input" | "off_topic";

export interface NodeResult {
  id: string;
  status: NodeStatus;
  points: string[];
  confidence: number;
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
