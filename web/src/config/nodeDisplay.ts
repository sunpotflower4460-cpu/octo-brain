// レンズの UI 表示 (視点の世界観)。docs/01_depth_design.md §4.1 のレンズ定義表が唯一の対応表。
// バックエンドの内部プロンプト(動詞)とは分離する (絶対ルール3)。ここはフロントの見せ方専用。
//
// index はバックエンド NODE_DEFS の並び順(=タコの腕の番号)。八芒星 {8/2} では
// 対角(同じ軸)の2腕は index が 4 離れる: time[0,4] heart[1,5] motion[2,6] soul[3,7]。

export interface NodeDisplay {
  uiName: string;
  emoji: string;
  plain: string; // 初見向けの平易な意味(docs/01_depth_design.md §4.1 の説明を要約)
  axis: string; // 軸ID
  axisLabel: string; // 軸ラベル(TENSION と対応)
  index: number; // 腕の番号 0..7
}

// バックエンド NODE_DEFS と同じ並び順。
export const LENS_ORDER = [
  "reason",
  "emotion",
  "risk",
  "empathy",
  "future",
  "truth",
  "step",
  "values",
] as const;

export const NODE_DISPLAY: Record<string, NodeDisplay> = {
  reason: { uiName: "論理", emoji: "🧠", plain: "事実と数字で考える", axis: "time", axisLabel: "時の軸", index: 0 },
  emotion: { uiName: "心", emoji: "💧", plain: "言葉の裏の本音", axis: "heart", axisLabel: "心の軸", index: 1 },
  risk: { uiName: "盾", emoji: "🛡️", plain: "見えない危うさ", axis: "motion", axisLabel: "動の軸", index: 2 },
  empathy: { uiName: "友", emoji: "🤝", plain: "味方として受け止める", axis: "soul", axisLabel: "魂の軸", index: 3 },
  future: { uiName: "望遠", emoji: "🔭", plain: "数年後からの視点", axis: "time", axisLabel: "時の軸", index: 4 },
  truth: { uiName: "鏡", emoji: "🪞", plain: "目を背けている事実", axis: "heart", axisLabel: "心の軸", index: 5 },
  step: { uiName: "一歩", emoji: "🎯", plain: "具体的な次の一手", axis: "motion", axisLabel: "動の軸", index: 6 },
  values: { uiName: "核", emoji: "💎", plain: "本当に大切なもの", axis: "soul", axisLabel: "魂の軸", index: 7 },
};

export function displayFor(id: string): NodeDisplay {
  return (
    NODE_DISPLAY[id] ?? { uiName: id, emoji: "🧩", plain: "", axis: "", axisLabel: "", index: -1 }
  );
}

// 軸ラベル(例: "心の軸")→ 対角2腕の腕番号(深化グロー用)。
// 未知の軸は空配列。
export function armsForAxis(axisLabel: string): number[] {
  const norm = axisLabel.trim();
  if (norm.length === 0) return [];
  return LENS_ORDER.map((id) => NODE_DISPLAY[id]).filter(
    (d) => d.axisLabel === norm || norm.includes(d.axisLabel),
  ).map((d) => d.index);
}

// レンズID配列 → 腕番号配列(共鳴グロー用)。深化と同じ index マッピングを流用。
// 実在しないIDは除外する。
export function armsForLenses(ids: string[]): number[] {
  return ids
    .map((id) => NODE_DISPLAY[id]?.index)
    .filter((i): i is number => typeof i === "number" && i >= 0);
}
