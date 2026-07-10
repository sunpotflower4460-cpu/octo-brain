// trace から Living Core / LensOrbit 用の表示モデルを組み立てる。

import { LENS_ORDER, displayFor } from "../../config/nodeDisplay";
import type { LensUiStatus, ThoughtTrace } from "../../lib/cognition";
import type { CoreLens, CoreViewModel } from "./CoreCanvas";

// レンズ固有の柔らかな色相(シアン190°〜バイオレット280°をレンズ順に)。
export const LENS_HUE: Record<string, number> = Object.fromEntries(
  LENS_ORDER.map((id, i) => [id, 188 + i * 12]),
);

export interface LensDisplay {
  id: string;
  uiName: string;
  emoji: string;
  axisLabel: string;
  status: LensUiStatus;
}

// nodeDisplay 順の8レンズ。trace が無ければ全 inactive。
export function displayLenses(trace: ThoughtTrace | null): LensDisplay[] {
  return LENS_ORDER.map((id) => {
    const d = displayFor(id);
    const status: LensUiStatus = trace?.nodeStates[id] ?? "inactive";
    return { id, uiName: d.uiName, emoji: d.emoji, axisLabel: d.axisLabel, status };
  });
}

export function buildCoreViewModel(
  trace: ThoughtTrace | null,
  reducedMotion: boolean,
  emphasis?: { ids: string[]; kind: "tension" | "resonance" },
): CoreViewModel {
  const lenses: CoreLens[] = LENS_ORDER.map((id) => {
    const status: LensUiStatus = trace?.nodeStates[id] ?? "inactive";
    const emph: CoreLens["emphasis"] =
      emphasis && emphasis.ids.includes(id) ? emphasis.kind : "none";
    return { id, status, emphasis: emph, hue: LENS_HUE[id] };
  });
  return { phase: trace?.phase ?? "idle", lenses, reducedMotion };
}

const STATUS_TEXT: Record<LensUiStatus, string> = {
  inactive: "未使用",
  queued: "待機",
  working: "分析中",
  done: "完了",
  timeout: "時間切れ",
  parse_error: "読み取り失敗",
  error: "接続失敗",
};

export function lensStatusText(s: LensUiStatus): string {
  return STATUS_TEXT[s];
}

export function isFailStatus(s: LensUiStatus): boolean {
  return s === "timeout" || s === "parse_error" || s === "error";
}
