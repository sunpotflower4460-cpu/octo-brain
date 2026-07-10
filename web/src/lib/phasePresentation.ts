// フェーズのユーザー向け表現 (P2.7 §6.2)。「解析」「処理」の連発を避け、意味の分かる日本語に。

import type { UiPhase } from "./cognition";

export interface PhasePresentation {
  name: string;
  hint: string;
  step: number; // 1..4 のメイン4段階。副次フェーズは0
  accent: "cyan" | "violet" | "gold" | "fuchsia" | "neutral";
}

const TABLE: Record<UiPhase, PhasePresentation> = {
  idle: { name: "待機", hint: "問いを入力してください", step: 0, accent: "neutral" },
  routing: {
    name: "問いを読む",
    hint: "どの軸とレンズで考えるかを選んでいます",
    step: 1,
    accent: "cyan",
  },
  nodes: {
    name: "8つのレンズ",
    hint: "複数の腕が同時に異なる角度を観ています",
    step: 2,
    accent: "cyan",
  },
  synth: {
    name: "視点を織る",
    hint: "中央脳が一致と緊張をひとつの理解にまとめています",
    step: 3,
    accent: "violet",
  },
  verify: {
    name: "光を整える",
    hint: "矛盾・断定の強さ・安全性を最終確認しています",
    step: 4,
    accent: "gold",
  },
  done: { name: "結晶化", hint: "回答がまとまりました", step: 4, accent: "violet" },
  deepening: {
    name: "緊張を深く掘る",
    hint: "対角の2本が互いの意見を読み直しています",
    step: 0,
    accent: "fuchsia",
  },
  resonating: {
    name: "遠い視点を響かせる",
    hint: "2本の腕から第三の選択肢を探しています",
    step: 0,
    accent: "cyan",
  },
  error: {
    name: "中断",
    hint: "接続が途切れました",
    step: 0,
    accent: "neutral",
  },
  cancelled: {
    name: "停止",
    hint: "生成を停止しました",
    step: 0,
    accent: "neutral",
  },
};

// 4段階のメインステップ定義(ProcessDock の上段用)。
export const MAIN_STEPS: { phase: UiPhase; short: string }[] = [
  { phase: "routing", short: "読む" },
  { phase: "nodes", short: "観る" },
  { phase: "synth", short: "織る" },
  { phase: "verify", short: "整える" },
];

export function presentPhase(phase: UiPhase): PhasePresentation {
  return TABLE[phase];
}

// plan のユーザー向け表示 (§9.2)。
export function planLabel(plan: "light" | "deep"): { title: string; desc: string } {
  return plan === "light"
    ? { title: "ライト", desc: "4つのレンズで素早く整理" }
    : { title: "ディープ", desc: "8つすべてで深く考える" };
}
