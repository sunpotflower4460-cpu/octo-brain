// 思考進行の状態モデル (P2.7 §6)。各アシスタント回答が自分の ThoughtTrace を持つ。
// SSE イベントから純関数で trace を更新する(テスト可能)。

import type { AppState, NodeStatus, NodeView } from "../types";

export type UiPhase =
  | "idle"
  | "routing"
  | "nodes"
  | "synth"
  | "verify"
  | "deepening"
  | "resonating"
  | "done"
  | "error"
  | "cancelled";

export type LensUiStatus =
  | "inactive"
  | "queued"
  | "working"
  | "done"
  | "timeout"
  | "parse_error"
  | "error";

export interface ThoughtTrace {
  phase: UiPhase;
  activeNodeIds: string[];
  nodeStates: Record<string, LensUiStatus>;
  quorum?: string;
  startedAt: number;
  completedAt?: number;
  cancelled?: boolean;
}

// Canvas用の派生3状態 (§6.1)。
export function deriveAppState(phase: UiPhase): AppState {
  if (phase === "routing" || phase === "nodes" || phase === "resonating") {
    return "processing_subs";
  }
  if (phase === "synth" || phase === "verify" || phase === "deepening") {
    return "processing_main";
  }
  return "idle";
}

export function createTrace(now: number): ThoughtTrace {
  return { phase: "routing", activeNodeIds: [], nodeStates: {}, startedAt: now };
}

// phase イベント。nodes の場合、起動レンズを working に、他は inactive に。
export function traceOnPhase(
  t: ThoughtTrace,
  phase: UiPhase,
  nodeIds?: string[],
): ThoughtTrace {
  if (phase === "nodes" && nodeIds && nodeIds.length > 0) {
    const nodeStates: Record<string, LensUiStatus> = { ...t.nodeStates };
    for (const id of nodeIds) {
      const cur = nodeStates[id];
      if (!cur || cur === "inactive" || cur === "queued") nodeStates[id] = "working";
    }
    return { ...t, phase: "nodes", activeNodeIds: nodeIds, nodeStates };
  }
  return { ...t, phase };
}

function mapNodeStatus(s: NodeStatus): LensUiStatus {
  if (s === "ok") return "done";
  if (s === "skipped") return "inactive";
  return s; // timeout | parse_error | error
}

// node 完了イベント(実到着時のみ状態を確定 — §14.4 真実性)。
export function traceOnNode(t: ThoughtTrace, node: NodeView): ThoughtTrace {
  return {
    ...t,
    nodeStates: { ...t.nodeStates, [node.id]: mapNodeStatus(node.status) },
  };
}

export function traceOnDone(
  t: ThoughtTrace,
  now: number,
  quorum?: string,
): ThoughtTrace {
  return { ...t, phase: "done", completedAt: now, quorum };
}

export function traceOnError(t: ThoughtTrace): ThoughtTrace {
  return { ...t, phase: "error" };
}

export function traceOnCancel(t: ThoughtTrace, now: number): ThoughtTrace {
  return { ...t, phase: "cancelled", completedAt: now, cancelled: true };
}

// 再起動時: 処理中だった trace を cancelled(中断)へ正規化する。
export function normalizeStaleTrace(t: ThoughtTrace): ThoughtTrace {
  const live: UiPhase[] = ["routing", "nodes", "synth", "verify", "deepening", "resonating"];
  if (live.includes(t.phase)) {
    return { ...t, phase: "cancelled", cancelled: true };
  }
  return t;
}

// 完了レンズ数と起動数。
export function lensProgress(t: ThoughtTrace): { done: number; active: number } {
  const active = t.activeNodeIds.length;
  const done = t.activeNodeIds.filter((id) => t.nodeStates[id] === "done").length;
  return { done, active };
}

export function failedLensCount(t: ThoughtTrace): number {
  return t.activeNodeIds.filter((id) => {
    const s = t.nodeStates[id];
    return s === "timeout" || s === "parse_error" || s === "error";
  }).length;
}
