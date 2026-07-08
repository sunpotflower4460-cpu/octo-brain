// ============================================================================
// 8レンズ(八芒星配置)。docs/01_depth_design.md §3.2, §4.1 が唯一の対応表。
//
// - 2つの正方形(見る四角 see / 感じる四角 feel)が45度ずれて重なる = 広さの二重奏
// - 4本の対角線(時/心/動/魂の軸) = 深さ。対角のレンズは意図的に張り合う対
//
// - verb   : 内部プロンプトの動詞(全ドメイン共通・完全固定)
// - uiName : UI表示名(表側の世界観。バックエンドのプロンプトに混入禁止 — 絶対ルール3)
// - square : "see"(外の現実を見る) / "feel"(内の心を感じる)
// - axis   : 対角ペアのID(time/heart/motion/soul)
// ============================================================================

import type { Domain, Plan } from "../types.js";

export type NodeId =
  | "reason"
  | "emotion"
  | "risk"
  | "empathy"
  | "future"
  | "truth"
  | "step"
  | "values";

export type AxisId = "time" | "heart" | "motion" | "soul";

export type Square = "see" | "feel";

export interface Lens {
  id: NodeId;
  verb: string; // 内部動詞 (§4.1) — 固定・全ドメイン共通
  uiName: string;
  emoji: string;
  square: Square;
  axis: AxisId;
}

// §4.1 の表(order 0〜7)。内部verbは「内部動詞」列をそのまま使う。
export const NODE_DEFS: Lens[] = [
  { id: "reason", verb: "感情を除き、事実と数字だけで状況を切り分ける", uiName: "論理", emoji: "🧠", square: "see", axis: "time" },
  { id: "emotion", verb: "言葉の裏で本当に感じていることを探り当てる", uiName: "心", emoji: "💧", square: "feel", axis: "heart" },
  { id: "risk", verb: "見えていない危うさ、引き返せなくなる地点を見積もる", uiName: "盾", emoji: "🛡️", square: "see", axis: "motion" },
  { id: "empathy", verb: "本人の味方として、そのままの気持ちを受け止めて言葉にする", uiName: "友", emoji: "🤝", square: "feel", axis: "soul" },
  { id: "future", verb: "半年後・数年後、この選択がどう見えているかを描く", uiName: "望遠", emoji: "🔭", square: "see", axis: "time" },
  { id: "truth", verb: "本人が目を背けている可能性を、正直にひとつだけ指摘する", uiName: "鏡", emoji: "🪞", square: "feel", axis: "heart" },
  { id: "step", verb: "明日できる最小の具体行動をひとつに絞る", uiName: "一歩", emoji: "🎯", square: "see", axis: "motion" },
  { id: "values", verb: "この人が本当に大切にしているものを、入力の言葉から掘り当てる", uiName: "核", emoji: "💎", square: "feel", axis: "soul" },
];

const NODE_BY_ID: Record<NodeId, Lens> = Object.fromEntries(
  NODE_DEFS.map((d) => [d.id, d]),
) as Record<NodeId, Lens>;

export function nodeDef(id: NodeId): Lens {
  return NODE_BY_ID[id];
}

export const ALL_LENS_IDS: NodeId[] = NODE_DEFS.map((d) => d.id);

// 4つの対角軸 (§3.2)。label は TENSION / meta に出る軸ラベル。
export interface AxisDef {
  id: AxisId;
  label: string;
  lenses: [NodeId, NodeId];
}

export const AXES: Record<AxisId, AxisDef> = {
  time: { id: "time", label: "時の軸", lenses: ["reason", "future"] },
  heart: { id: "heart", label: "心の軸", lenses: ["emotion", "truth"] },
  motion: { id: "motion", label: "動の軸", lenses: ["risk", "step"] },
  soul: { id: "soul", label: "魂の軸", lenses: ["empathy", "values"] },
};

export function axisLabel(id: AxisId): string {
  return AXES[id].label;
}

// 軸ラベル(統合脳が出す "心の軸" 等)から AxisDef を引く。深化で使う。
export function axisByLabel(label: string): AxisDef | null {
  const norm = label.trim();
  for (const a of Object.values(AXES)) {
    if (a.label === norm || norm.includes(a.label) || a.id === norm) return a;
  }
  return null;
}

// ドメイン→起動する2軸 (§4.3)。迷ったら心+動。
export const DOMAIN_AXES: Record<Domain, AxisId[]> = {
  love: ["heart", "soul"],
  work: ["time", "motion"],
  money: ["time", "motion"],
  family: ["heart", "soul"],
  self: ["heart", "soul"],
  general: ["heart", "motion"],
};

// プラン+ドメインで起動するレンズを決める (§6)。
//   deep  → 全8腕
//   light → ドメインの2軸=4腕
export function planLenses(plan: Plan, domain: Domain): NodeId[] {
  if (plan === "deep") return ALL_LENS_IDS;
  return DOMAIN_AXES[domain].flatMap((a) => AXES[a].lenses);
}

// クォーラム(最低成功数)。deep=8腕、light=4腕。
export function planQuorum(plan: Plan): number {
  return plan === "deep" ? 4 : 2;
}

// §4.1 のノード共通システムプロンプト (固定・キャッシュ前提)。opinions形式。
export const COMMON_NODE_SYSTEM = `あなたはOctoBrainの分析レンズです。与えられたタスクだけを実行してください。
- 出力は指定のJSONのみ。前置き・後書き・コードフェンス禁止
- opinions は最大3件。各 claim・why は60字以内。weight は0〜1の確信度
- わからない場合は opinions を空にし flag に "insufficient_input" を設定`;

// 出力スキーマ (§4.1)。フラット・最大3・キー名固定(軽量モデルが崩れないように)。
const NODE_OUTPUT_FORMAT = `出力JSON形式: {"opinions":[{"claim":"60字以内","weight":0.0〜1.0,"why":"60字以内"}],"flag":null | "insufficient_input" | "off_topic"}`;

// レンズごとのシステムプロンプト = 共通固定文 + 動詞タスク1行 + 出力形式。
// すべて静的(レンズidにのみ依存)。ユーザー入力は user メッセージへ。
export function nodeSystemPrompt(def: Lens): string {
  return `${COMMON_NODE_SYSTEM}\n\nタスク: ${def.verb}\n\n${NODE_OUTPUT_FORMAT}`;
}
