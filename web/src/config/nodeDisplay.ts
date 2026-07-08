// レンズの UI 表示 (視点の世界観)。docs/01_depth_design.md §4.1 のレンズ定義表が唯一の対応表。
// バックエンドの内部プロンプト(動詞)とは分離する (絶対ルール3)。ここはフロントの見せ方専用。
//
// index はバックエンド NODE_DEFS の並び順(=タコの腕の番号)。八芒星 {8/2} では
// 対角(同じ軸)の2腕は index が 4 離れる: time[0,4] heart[1,5] motion[2,6] soul[3,7]。

export interface NodeDisplay {
  uiName: string;
  emoji: string;
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
  reason: { uiName: "論理", emoji: "🧠", axis: "time", axisLabel: "時の軸", index: 0 },
  emotion: { uiName: "心", emoji: "💧", axis: "heart", axisLabel: "心の軸", index: 1 },
  risk: { uiName: "盾", emoji: "🛡️", axis: "motion", axisLabel: "動の軸", index: 2 },
  empathy: { uiName: "友", emoji: "🤝", axis: "soul", axisLabel: "魂の軸", index: 3 },
  future: { uiName: "望遠", emoji: "🔭", axis: "time", axisLabel: "時の軸", index: 4 },
  truth: { uiName: "鏡", emoji: "🪞", axis: "heart", axisLabel: "心の軸", index: 5 },
  step: { uiName: "一歩", emoji: "🎯", axis: "motion", axisLabel: "動の軸", index: 6 },
  values: { uiName: "核", emoji: "💎", axis: "soul", axisLabel: "魂の軸", index: 7 },
};

export function displayFor(id: string): NodeDisplay {
  return (
    NODE_DISPLAY[id] ?? { uiName: id, emoji: "🧩", axis: "", axisLabel: "", index: -1 }
  );
}

// 軸ラベル(例: "心の軸")→ 対角2腕の腕番号(canvasのハイライト用)。
// 未知の軸は空配列。
export function armsForAxis(axisLabel: string): number[] {
  const norm = axisLabel.trim();
  if (norm.length === 0) return [];
  return LENS_ORDER.map((id) => NODE_DISPLAY[id]).filter(
    (d) => d.axisLabel === norm || norm.includes(d.axisLabel),
  ).map((d) => d.index);
}
