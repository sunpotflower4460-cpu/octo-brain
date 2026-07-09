// opinion 選択ロジック(P2.6 §2)。テスト可能なように純関数として切り出す。
// - 2つ選ぶと掛け合わせ可能
// - 同一lens内の2つは選べない(same-lens は拒否)
// - 3つ目を選んだら最初の選択を解除(FIFO)

export interface Selected {
  key: string; // `${lens}:${opinionIndex}`
  lens: string;
  claim: string;
}

export interface ToggleResult {
  selected: Selected[];
  // 同一lensで拒否したときのヒント(それ以外は空)
  rejected: boolean;
}

export function toggleSelection(
  prev: Selected[],
  candidate: Selected,
): ToggleResult {
  // すでに選択済み → 解除
  if (prev.some((s) => s.key === candidate.key)) {
    return { selected: prev.filter((s) => s.key !== candidate.key), rejected: false };
  }
  // 同一lensは掛け合わせられない
  if (prev.some((s) => s.lens === candidate.lens)) {
    return { selected: prev, rejected: true };
  }
  if (prev.length < 2) {
    return { selected: [...prev, candidate], rejected: false };
  }
  // 3つ目 → 最初を解除して追加
  return { selected: [prev[1], candidate], rejected: false };
}

export function canResonate(selected: Selected[]): boolean {
  return selected.length === 2 && selected[0].lens !== selected[1].lens;
}
