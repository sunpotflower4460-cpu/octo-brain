// ストリーミング分析パイプライン (P2 §1, docs/00_architecture.md §9 SSE契約)。
// P1の analyze.ts と同じ段取りだが、各段階で SSE イベントを emit する:
//   phase (routing/nodes/synth/verify) / node / token / done / error
// ノードは完了順に node イベントを送り、Synthesizer は token を逐次送出、
// Verifier はストリーム完了後に実行して done に反映する。

import { classifyRoute } from "./router.js";
import { runNodes } from "./runNodes.js";
import {
  synthesizeStream,
  synthesizeFallbackStream,
} from "./synthesize.js";
import { verify } from "./verify.js";
import { CostCollector, incrementQuota, logCost } from "./costlog.js";
import type { AnalyzeInput, AnalyzeDeps, AnalyzeMeta } from "./analyze.js";
import type { Route } from "../types.js";

export type SSEPhase = "routing" | "nodes" | "synth" | "verify";

// SSE 1イベントを送出するコールバック。
export type EmitFn = (event: string, data: unknown) => void;

export async function runAnalyzeStream(
  req: AnalyzeInput,
  deps: AnalyzeDeps,
  emit: EmitFn,
): Promise<void> {
  const started = deps.now.getTime();
  const collector = new CostCollector();
  const warnings: string[] = [];

  // ① Router
  emit("phase", { phase: "routing" satisfies SSEPhase });
  const route: Route =
    req.mode === "auto"
      ? await classifyRoute(req.input, { env: deps.env, collector })
      : req.mode;

  // ② 並列ノード (完了順に node イベント)
  emit("phase", { phase: "nodes" satisfies SSEPhase });
  const run = await runNodes(route, req.input, req.summary, {
    env: deps.env,
    collector,
    nodeTimeoutMs: deps.nodeTimeoutMs,
    onNodeComplete: (n) =>
      emit("node", {
        id: n.id,
        status: n.status,
        points: n.points,
        confidence: n.confidence,
      }),
  });

  // ③ 統合 (token 逐次) or フォールバック
  emit("phase", { phase: "synth" satisfies SSEPhase });
  const onToken = (t: string) => emit("token", { t });
  const synth = run.fallback
    ? await synthesizeFallbackStream(
        req.input,
        req.summary,
        { env: deps.env, collector },
        onToken,
      )
    : await synthesizeStream(
        req.input,
        req.summary,
        run.nodes,
        { env: deps.env, collector },
        onToken,
      );

  // ④ 検証 (ストリーム完了後。修正時のみ done の answer を差し替え)
  emit("phase", { phase: "verify" satisfies SSEPhase });
  const verified = await verify(synth.answer, { env: deps.env, collector });

  const quorumStr = `${run.successCount}/${run.nodes.length}`;

  // ⑤ 原価ログ + クォータ (KV)。失敗は握りつぶさず warnings に。
  let quotaUsed: number | null = null;
  try {
    await logCost(
      deps.env.OCTO_KV,
      deps.requestId,
      collector,
      { quorum: quorumStr, fallback: run.fallback },
      deps.now,
    );
  } catch (err) {
    warnings.push(`cost_log_failed: ${errMsg(err)}`);
  }
  try {
    quotaUsed = await incrementQuota(deps.env.OCTO_KV, req.clientId, deps.now);
  } catch (err) {
    warnings.push(`quota_increment_failed: ${errMsg(err)}`);
  }

  const meta: AnalyzeMeta = {
    route,
    quorum: quorumStr,
    fallback: run.fallback,
    verified: verified.modified ? "modified" : "pass",
    totalCost: collector.totalCost(),
    ms: Date.now() - started,
    quotaUsed,
  };
  if (warnings.length > 0) meta.warnings = warnings;

  // ⑥ done (一括JSONと同形)
  emit("done", {
    answer: verified.text,
    summary: synth.summary,
    nodes: run.nodes.map((n) => ({
      id: n.id,
      status: n.status,
      points: n.points,
      confidence: n.confidence,
    })),
    meta,
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
