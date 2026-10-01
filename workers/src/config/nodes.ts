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
  { id: "reason", verb: "判断を左右するのに、入力からはまだ確かめられていない事実・数字・前提を特定する", uiName: "論理", emoji: "🧠", square: "see", axis: "time" },
  { id: "emotion", verb: "言葉の裏で本当に感じていることを探り当てる", uiName: "心", emoji: "💧", square: "feel", axis: "heart" },
  { id: "risk", verb: "見えていない危うさ、引き返せなくなる地点を見積もる", uiName: "盾", emoji: "🛡️", square: "see", axis: "motion" },
  { id: "empathy", verb: "本人の味方として、そのままの気持ちを受け止めて言葉にする", uiName: "友", emoji: "🤝", square: "feel", axis: "soul" },
  { id: "future", verb: "半年後・数年後、この選択がどう見えているかを描く", uiName: "望遠", emoji: "🔭", square: "see", axis: "time" },
  { id: "truth", verb: "本人が目を背けている可能性を、正直にひとつだけ指摘する", uiName: "鏡", emoji: "🪞", square: "feel", axis: "heart" },
  { id: "step", verb: "この状況や依頼を前に進める、いちばん小さな具体的行動をひとつに絞る", uiName: "一歩", emoji: "🎯", square: "see", axis: "motion" },
  { id: "values", verb: "この人が本当に大切にしているものを、入力の言葉から掘り当てる", uiName: "核", emoji: "💎", square: "feel", axis: "soul" },
];

const NODE_BY_ID: Record<NodeId, Lens> = Object.fromEntries(
  NODE_DEFS.map((d) => [d.id, d]),
) as Record<NodeId, Lens>;

export function nodeDef(id: NodeId): Lens {
  return NODE_BY_ID[id];
}

export const ALL_LENS_IDS: NodeId[] = NODE_DEFS.map((d) => d.id);

// 文字列が実在の NodeId(8レンズ)か判定する。resonance の lens 検証などに使う。
export function isNodeId(s: unknown): s is NodeId {
  return typeof s === "string" && s in NODE_BY_ID;
}

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
// 完全一致を優先し、部分一致は「ちょうど1軸だけ」に限る(複数軸が含まれる曖昧文は null)。
export function axisByLabel(label: string): AxisDef | null {
  const norm = label.trim();
  if (norm.length === 0) return null;
  for (const a of Object.values(AXES)) {
    if (a.label === norm || a.id === norm) return a;
  }
  const hits = Object.values(AXES).filter((a) => norm.includes(a.label));
  return hits.length === 1 ? hits[0] : null;
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
- 入力に書かれていることの言い換え・要約は意見にしない。入力から一歩踏み込んだ指摘だけを書く
- 一般的な質問や、本人の事情が書かれていない相談でも、タスクの観点で具体的な意見を必ず出す。情報が足りない部分は、よくある状況を仮定して意見を出し、その仮定を why に書く
- flag の "insufficient_input" は、入力が短すぎる・意味をなさないなど、仮定を置いても意見が出せないときだけに使う`;

// 出力スキーマ (§4.1)。フラット・最大3・キー名固定(軽量モデルが崩れないように)。
const NODE_OUTPUT_FORMAT = `出力JSON形式: {"opinions":[{"claim":"60字以内","weight":0.0〜1.0,"why":"60字以内"}],"flag":null | "insufficient_input" | "off_topic"}`;

// レンズごとのシステムプロンプト = 共通固定文 + 動詞タスク1行 + 出力形式。
// すべて静的(レンズidにのみ依存)。ユーザー入力は user メッセージへ。
export function nodeSystemPrompt(def: Lens): string {
  return `${COMMON_NODE_SYSTEM}\n\nタスク: ${def.verb}\n\n${NODE_OUTPUT_FORMAT}`;
}

// 世界つきの探求(相談ごとに選んだ「違う世界」に立って、同じ問いを探求する)。
// 世界の名前と日常は user メッセージの [あなたの世界] で渡す(システムプロンプトはレンズごとに静的)。
const WORLD_NODE_RULES = `この相談を、[あなたの世界] に生きる人の目で探求する。
- experience: その世界に独自の知恵・慣習・判断基準のうち、この相談に通じるものを、具体的な場面とともに書き、相談者の状況に置き換える(100字以内)。相談者の業界の人でも言える一般論(「年齢より経験が大事」など)は書かない。架空の個人の体験談(「私は〜した」)は作らず、「〜の世界では」のように、その世界でよくあることとして書く
- facts: この相談の判断に直接関わる実際の情報(制度・相場・統計・よく知られた傾向など、相談者が調べれば確かめられるもの)を最大2件(各60字以内)。あなたのタスクの観点に関わるものを選ぶ。「人による」「状況で変わる」のような中身のない一般論は書かない。sure は確からしさ(0〜1)。うろ覚えの数字は書かないか、sure を低くする
- move: その世界の知恵を、この相談者が今週できる具体的な一手に置き換える(60字以内)。数字・期限・相手への言い方のどれかを必ず含める(例:「開業前に、月の売上が○万円を3か月下回ったら撤退と紙に書いて決める」)
- opinions: タスクの観点から相談者への意見を出す。少なくとも1つは、その世界の知恵を相談者の状況に置き換えた意見にする`;

const WORLD_NODE_OUTPUT_FORMAT = `出力JSON形式: {"experience":"100字以内","move":"60字以内","facts":[{"text":"60字以内","sure":0.0〜1.0}],"opinions":[{"claim":"60字以内","weight":0.0〜1.0,"why":"60字以内"}],"flag":null | "insufficient_input" | "off_topic"}`;



// 照合モード: 答えが法律・制度・手続き・事実で決まる質問。違う意見ではなく、独立した確かめを集める
// (8人で別々にダブルチェックするイメージ)。各腕は自分のタスクの観点から、答えを左右する事実を確かめる。
// [調べて確かめた資料] があれば、それに基づかせる。
const CHECK_NODE_RULES = `この質問は、答えが法律・制度・手続き・事実で決まる。あなたは独立した確認役として、タスクの観点から答えを確かめる。
- facts: 答えを左右する事実(結論・成立の条件・例外・期限・金額・手続き)を最大3件(各60字以内)。日数・金額・期限・制度の正式名など、具体的な中身を書く(「条件による」で終えない)。状況で答えが分かれるなら、分かれ目(雇用形態・勤続期間・契約の種類など)とそれぞれの答えを書く。[調べて確かめた資料] があればそれに基づき、資料にないことは sure を低くする。sure は確からしさ(0〜1)。うろ覚えの数字・条番号は書かない。資料そのものへの論評(「資料には定義しかない」など)は書かない
- move: 相談者が次に取るべき具体的な手順を1つ(60字以内。確認先・書面・期限・言い方のどれかを含める)
- opinions: タスクの観点から相談者への意見(見落としやすい条件、相手への伝え方、取り返しのつかない点など)`;

const CHECK_NODE_OUTPUT_FORMAT = `出力JSON形式: {"facts":[{"text":"60字以内","sure":0.0〜1.0}],"move":"60字以内","opinions":[{"claim":"60字以内","weight":0.0〜1.0,"why":"60字以内"}],"flag":null | "insufficient_input" | "off_topic"}`;

// ---------------------------------------------------------------------------
// 腕の共有システムプロンプト(世界つき・照合・従来)。
// 全腕で同じ文にし、担当(動詞)は user メッセージの先頭に置く。こうすると同じリクエストの腕どうし・
// 後続のリクエストで先頭が一致し、プロンプトキャッシュ(入力が約1/10の単価)が効く(1024トークン以上で有効)。
// あわせて他の担当の一覧を見せ、観点が重ならないようにする(評価で「視点の重複が多い」と指摘されたため)。
// ---------------------------------------------------------------------------
export type NodeMode = "plain" | "world" | "check";

const SHARED_NODE_HEAD = `あなたはOctoBrainの分析レンズです。user メッセージの [あなたの担当] に書かれたタスクだけを実行してください。
- 出力は指定のJSONのみ。前置き・後書き・コードフェンス禁止
- opinions は最大3件。各 claim・why は60字以内。weight は0〜1の確信度
- 入力に書かれていることの言い換え・要約は意見にしない。入力から一歩踏み込んだ指摘だけを書く
- 一般的な質問や、本人の事情が書かれていない相談でも、担当の観点で具体的な意見を必ず出す。情報が足りない部分は、よくある状況を仮定して意見を出し、その仮定を why に書く
- flag の "insufficient_input" は、入力が短すぎる・意味をなさないなど、仮定を置いても意見が出せないときだけに使う`;

const LENS_ROSTER = `同じ相談を、次の8つの担当が別々に見ている。担当ごとに観点が違う。自分の担当の観点に集中し、他の担当の観点は書かない(重ならないことで、全体として見落としが減る):
${NODE_DEFS.map((d, i) => `${i + 1}. ${d.verb}`).join("\n")}`;

export function nodeSharedSystem(mode: NodeMode): string {
  const rules = mode === "world" ? WORLD_NODE_RULES : mode === "check" ? CHECK_NODE_RULES : "";
  const format =
    mode === "world" ? WORLD_NODE_OUTPUT_FORMAT : mode === "check" ? CHECK_NODE_OUTPUT_FORMAT : NODE_OUTPUT_FORMAT;
  return [SHARED_NODE_HEAD, LENS_ROSTER, rules, format].join("\n\n");
}

// user メッセージの先頭に置く担当
export function nodeTaskLine(def: Lens): string {
  return `[あなたの担当]\n${def.verb}`;
}
