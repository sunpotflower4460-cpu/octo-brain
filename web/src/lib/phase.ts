// SSE の phase イベント → タコUIの appState への写像 (docs/00_architecture.md §9末尾)。
//   nodes  → processing_subs  (8基のエッジノードが並列解析)
//   synth 以降 → processing_main (メインコアが統合)
// routing はノード起動前の準備段階なので subs 側に寄せる。

import type { AppState, SSEPhase } from "../types";

export function phaseToAppState(phase: SSEPhase): AppState {
  switch (phase) {
    case "routing":
    case "nodes":
      return "processing_subs";
    case "synth":
    case "verify":
      return "processing_main";
  }
}
