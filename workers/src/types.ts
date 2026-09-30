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
  // 出力上限(max_tokens)で打ち切られた場合 true(finish_reason=length 等)
  truncated?: boolean;
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
  // プロバイダーの1分あたり上限の実測(応答ヘッダー x-ratelimit-*)。規模の見積もりに使う
  rl?: RateLimitSnapshot;
  // 主のプロバイダーが混雑・障害で、切り替え先で応答した
  fallback?: boolean;
}

export interface RateLimitSnapshot {
  limitRequests?: number;
  remainingRequests?: number;
  limitTokens?: number;
  remainingTokens?: number;
}

// callModel が呼び出しごとに原価ログを書き込む先。
// リクエスト単位の CostCollector が実装する (絶対ルール5)。
export interface CostSink {
  record(rec: CostCallRecord): void;
}

// ---- 深化アーキテクチャ (P1.5, docs/01_depth_design.md) ----

// プラン: light=2軸4腕(1単位) / deep=4軸8腕(2単位)。どちらも無料(課金なし運用)
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

// 共鳴 (P1.6): 軸をまたいで響き合う2つのopinionの組と、その共通の根。
// {8/2}の対角線=TENSION(対立から掘る)の対概念。{8/3}の一筆書き=RESONANCE(結合から生む)。
export interface ResonancePair {
  lens: string; // NodeId
  claim: string;
}
export interface Resonance {
  a: ResonancePair;
  b: ResonancePair;
  root: string; // 共通の根
}

// 視点の地図: 単体のモデルが1つの最善の答えに畳むと見えなくなる、視点の分布。
// 合意の強さ(何人中何人)・割れたところ・ひとつだけの指摘(少数意見)。
export interface PerspectiveMap {
  agree: { point: string; lenses: string[] } | null; // lenses: NodeId(2つ以上)
  split: { about: string; a: ResonancePair; b: ResonancePair } | null;
  lone: { lens: string; claim: string; why: string } | null;
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
  // IP 単位のバースト制限(Cloudflare Rate Limiting バインディング)。未設定ならスキップ
  IP_RATE_LIMITER?: RateLimit;
  // APIキー等のシークレットは keyEnv 経由で動的参照する (Record<string, string>)
  [key: string]: unknown;
}
