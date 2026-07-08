// ストリーミング分析パイプライン (docs/00_architecture.md §9 SSE + P1.5 拡張)。
// analyze.ts と同じ段取りで各段階に SSE イベントを emit する:
//   phase (routing/nodes/synth/verify) / node / token / done / error
// done の meta に plan/domain/tension を含める。

import { classifyDomain } from "./router.js";
import { runNodes } from "./runNodes.js";
import {
  synthesizeStream,
  synthesizeFallbackStream,
} from "./synthesize.js";
import { verify } from "./verify.js";
import { CostCollector, incrementQuota, logCost } from "./costlog.js";
import { planLenses, planQuorum } from "../config/nodes.js";
import type { AnalyzeInput, AnalyzeDeps, AnalyzeMeta } from "./analyze.js";
import type { Domain } from "../types.js";

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
  const domain: Domain = await classifyDomain(req.input, {
    env: deps.env,
    collector,
  });

  // ② プラン別レンズ並列(完了順に node イベント)
  emit("phase", { phase: "nodes" satisfies SSEPhase });
  const lensIds = planLenses(req.plan, domain);
  const required = planQuorum(req.plan);
  const run = await runNodes(lensIds, required, req.input, req.summary, {
    env: deps.env,
    collector,
    nodeTimeoutMs: deps.nodeTimeoutMs,
    onNodeComplete: (n) =>
      emit("node", { id: n.id, status: n.status, opinions: n.opinions }),
  });

  // ③ 掘る統合(token 逐次) or フォールバック
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

  // ④ 検証
  emit("phase", { phase: "verify" satisfies SSEPhase });
  const verified = await verify(synth.answer, { env: deps.env, collector });

  const quorumStr = `${run.successCount}/${run.nodes.length}`;

  // ⑤ 原価ログ + クォータ
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
    plan: req.plan,
    domain,
    quorum: quorumStr,
    fallback: run.fallback,
    tension: synth.tension,
    verified: verified.modified ? "modified" : "pass",
    totalCost: collector.totalCost(),
    ms: Date.now() - started,
    quotaUsed,
  };
  if (warnings.length > 0) meta.warnings = warnings;

  // ⑥ done(一括JSONと同形)
  emit("done", {
    answer: verified.text,
    summary: synth.summary,
    nodes: run.nodes.map((n) => ({
      id: n.id,
      status: n.status,
      opinions: n.opinions,
    })),
    meta,
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
