import { describe, expect, it } from "vitest";
import {
  createTrace,
  deriveAppState,
  failedLensCount,
  lensProgress,
  normalizeStaleTrace,
  traceOnCancel,
  traceOnDone,
  traceOnError,
  traceOnNode,
  traceOnPhase,
} from "./cognition";
import type { NodeView } from "../types";

function node(id: string, status: NodeView["status"]): NodeView {
  return { id, status, opinions: [] };
}

describe("deriveAppState", () => {
  it("routing/nodes/resonating → processing_subs", () => {
    expect(deriveAppState("routing")).toBe("processing_subs");
    expect(deriveAppState("nodes")).toBe("processing_subs");
    expect(deriveAppState("resonating")).toBe("processing_subs");
  });
  it("synth/verify/deepening → processing_main", () => {
    expect(deriveAppState("synth")).toBe("processing_main");
    expect(deriveAppState("verify")).toBe("processing_main");
    expect(deriveAppState("deepening")).toBe("processing_main");
  });
  it("idle/done/error/cancelled → idle", () => {
    expect(deriveAppState("idle")).toBe("idle");
    expect(deriveAppState("done")).toBe("idle");
    expect(deriveAppState("cancelled")).toBe("idle");
  });
});

describe("trace 更新", () => {
  it("nodes フェーズで起動レンズを working に、他は未設定(inactive相当)", () => {
    let t = createTrace(0);
    t = traceOnPhase(t, "nodes", ["reason", "future"]);
    expect(t.phase).toBe("nodes");
    expect(t.activeNodeIds).toEqual(["reason", "future"]);
    expect(t.nodeStates.reason).toBe("working");
    expect(t.nodeStates.emotion).toBeUndefined();
  });

  it("node 到着で working→done / 失敗ステータス / skipped→inactive", () => {
    let t = createTrace(0);
    t = traceOnPhase(t, "nodes", ["reason", "risk", "step", "future"]);
    t = traceOnNode(t, node("reason", "ok"));
    t = traceOnNode(t, node("risk", "timeout"));
    t = traceOnNode(t, node("step", "skipped"));
    expect(t.nodeStates.reason).toBe("done");
    expect(t.nodeStates.risk).toBe("timeout");
    expect(t.nodeStates.step).toBe("inactive");
    expect(t.nodeStates.future).toBe("working");
  });

  it("lensProgress は起動数と完了数を返す", () => {
    let t = createTrace(0);
    t = traceOnPhase(t, "nodes", ["a", "b", "c", "d"]);
    t = traceOnNode(t, node("a", "ok"));
    t = traceOnNode(t, node("b", "ok"));
    t = traceOnNode(t, node("c", "error"));
    expect(lensProgress(t)).toEqual({ done: 2, active: 4 });
    expect(failedLensCount(t)).toBe(1);
  });

  it("done/error/cancel が phase を確定する", () => {
    let t = createTrace(0);
    expect(traceOnDone(t, 100, "4/4").phase).toBe("done");
    expect(traceOnDone(t, 100, "4/4").quorum).toBe("4/4");
    expect(traceOnError(t).phase).toBe("error");
    t = traceOnCancel(t, 200);
    expect(t.phase).toBe("cancelled");
    expect(t.cancelled).toBe(true);
  });

  it("normalizeStaleTrace は処理中を cancelled に正規化(完了系はそのまま)", () => {
    const live = normalizeStaleTrace({ ...createTrace(0), phase: "synth" });
    expect(live.phase).toBe("cancelled");
    const done = normalizeStaleTrace({ ...createTrace(0), phase: "done" });
    expect(done.phase).toBe("done");
  });
});
