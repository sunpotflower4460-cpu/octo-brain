// ノードの UI 表示 (視点の世界観)。docs/00_architecture.md §2 のノード定義表が唯一の対応表。
// バックエンドの内部プロンプト(動詞)とは分離する (絶対ルール3)。
// ここはフロントの見せ方専用。

export interface NodeDisplay {
  uiName: string;
  emoji: string;
}

export const NODE_DISPLAY: Record<string, NodeDisplay> = {
  assumptions: { uiName: "論理", emoji: "🧠" },
  counter: { uiName: "批判", emoji: "⚡" },
  gaps: { uiName: "探索", emoji: "🔍" },
  options: { uiName: "創造", emoji: "✨" },
  worst: { uiName: "リスク", emoji: "🛡️" },
  next: { uiName: "実行", emoji: "🎯" },
  compress: { uiName: "要約", emoji: "📝" },
  overclaim: { uiName: "慎重", emoji: "⚖️" },
};

export function displayFor(id: string): NodeDisplay {
  return NODE_DISPLAY[id] ?? { uiName: id, emoji: "🧩" };
}
