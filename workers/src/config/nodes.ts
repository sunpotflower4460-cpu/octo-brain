// ============================================================================
// 8動詞ノード定義。docs/00_architecture.md §2 のノード定義表が唯一の対応表。
//
// - verb   : 内部プロンプトの動詞 (バックエンドのプロンプトに使う)
// - uiName : UI表示名 (フロントの見せ方のみ。バックエンドのプロンプトに混入禁止 — 絶対ルール3)
// - emoji  : UI用
//
// 共通システムプロンプトは全リクエストで完全固定 (プロンプトキャッシュのため)。
// ユーザー入力は user メッセージ側にのみ入れ、system には動的文字列を埋め込まない。
// ============================================================================

import type { Route } from "../types.js";

export type NodeId =
  | "assumptions"
  | "counter"
  | "gaps"
  | "options"
  | "worst"
  | "next"
  | "compress"
  | "overclaim";

export interface NodeDef {
  id: NodeId;
  verb: string; // 内部プロンプトの動詞 (§2)
  uiName: string; // UI表示名 (§2)
  emoji: string;
}

export const NODE_DEFS: NodeDef[] = [
  { id: "assumptions", verb: "入力に含まれる暗黙の前提を抽出する", uiName: "論理", emoji: "🧠" },
  { id: "counter", verb: "最も強い反例・反論を1つ構成する", uiName: "批判", emoji: "⚡" },
  { id: "gaps", verb: "判断に欠けている情報を列挙する", uiName: "探索", emoji: "🔍" },
  { id: "options", verb: "進め方を性質の異なる3つの選択肢に分岐する", uiName: "創造", emoji: "✨" },
  { id: "worst", verb: "最悪シナリオとその発生条件を見積もる", uiName: "リスク", emoji: "🛡️" },
  { id: "next", verb: "具体的な次の一手を1つに絞って提案する", uiName: "実行", emoji: "🎯" },
  { id: "compress", verb: "入力の本質を3行以内に圧縮する", uiName: "要約", emoji: "📝" },
  { id: "overclaim", verb: "入力や前提の中の断定しすぎ・根拠不足を検出する", uiName: "慎重", emoji: "⚖️" },
];

const NODE_BY_ID: Record<NodeId, NodeDef> = Object.fromEntries(
  NODE_DEFS.map((d) => [d.id, d]),
) as Record<NodeId, NodeDef>;

export function nodeDef(id: NodeId): NodeDef {
  return NODE_BY_ID[id];
}

// §2 のノード共通システムプロンプト (固定・キャッシュ前提)。動的文字列を混ぜない。
export const COMMON_NODE_SYSTEM = `あなたはOctoBrainの分析ノードです。与えられたタスクだけを実行してください。
- 出力は指定のJSONのみ。前置き・後書き・コードフェンス禁止
- 各pointは60字以内。最大3つ
- わからない場合は points を空にし flag に "insufficient_input" を設定`;

// 出力スキーマ (§2)。system に固定で載せる (静的なのでキャッシュを壊さない)。
const NODE_OUTPUT_FORMAT = `出力JSON形式: {"points":["..."],"confidence":0.0〜1.0,"flag":null | "insufficient_input" | "off_topic"}`;

// ノードごとのシステムプロンプト = 共通固定文 + 動詞タスク1行 + 出力形式。
// すべて静的 (ノードidにのみ依存し、ユーザー入力に依存しない)。
export function nodeSystemPrompt(def: NodeDef): string {
  return `${COMMON_NODE_SYSTEM}\n\nタスク: ${def.verb}\n\n${NODE_OUTPUT_FORMAT}`;
}

// §3 ルーティング表 (動的起動)。
export const ROUTE_NODES: Record<Route, NodeId[]> = {
  simple: ["compress", "next"],
  normal: ["assumptions", "counter", "options", "next"],
  complex: ["assumptions", "counter", "gaps", "options", "worst", "next", "compress", "overclaim"],
};

// §3 クォーラム (最低成功数)。
export const QUORUM: Record<Route, number> = {
  simple: 2,
  normal: 3,
  complex: 5,
};
