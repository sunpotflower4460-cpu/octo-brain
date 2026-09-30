// ストリーミング分析パイプライン (docs/00_architecture.md §9 SSE + P1.5 拡張)。
// analyze.ts と同じ段取りで各段階に SSE イベントを emit する:
//   phase (routing/nodes/synth/verify) / node / token / done / error
// done の meta に plan/domain/tension を含める。

import { classifyDomain } from "./router.js";
import { runNodes } from "./runNodes.js";
import { synthesizeStream, synthesizeFallbackStream, validResonance } from "./synthesize.js";
import { verify } from "./verify.js";
import { polishAnswer } from "./polish.js";
import { shouldOfferSupport, detectCare } from "./care.js";
import { CostCollector, incrementQuota, logCost, logFailedCost } from "./costlog.js";
import { QUOTA_UNITS } from "./guard.js";
import { detectBoundary, boundaryPrefix, withBoundaryPrefix } from "./boundary.js";
import { planLenses, planQuorum } from "../config/nodes.js";
import { toNodeView, type AnalyzeInput, type AnalyzeDeps, type AnalyzeMeta } from "./analyze.js";
import type { Domain } from "../types.js";

export type SSEPhase = "routing" | "nodes" | "synth" | "verify";

// SSE 1イベントを送出するコールバック。
export type EmitFn = (event: string, data: unknown) => void;

export async function runAnalyzeStream(
  req: AnalyzeInput,
  deps: AnalyzeDeps,
  emit: EmitFn,
): Promise<void> {
  const collector = new CostCollector();
  try {
    return await runAnalyzeStreamInner(req, deps, emit, collector);
  } catch (err) {
    // 途中までの課金済み呼び出しを原価ログに残す(監査 H8)
    await logFailedCost(
      deps.env.OCTO_KV,
      deps.requestId,
      collector,
      "analyze",
      deps.now.getTime(),
      deps.now,
    );
    throw err;
  }
}

async function runAnalyzeStreamInner(
  req: AnalyzeInput,
  deps: AnalyzeDeps,
  emit: EmitFn,
  collector: CostCollector,
): Promise<void> {
  const started = deps.now.getTime();
  const warnings: string[] = [];

  // ① Router
  emit("phase", { phase: "routing" satisfies SSEPhase });
  const domain: Domain = await classifyDomain(req.input, {
    env: deps.env,
    collector,
    signal: deps.signal,
  });

  // ② プラン別レンズ並列(完了順に node イベント)
  // nodes フェーズで起動レンズIDを同送し、UIが真に起動した腕だけを working 表示できるようにする。
  const lensIds = planLenses(req.plan, domain);
  const required = planQuorum(req.plan);
  emit("phase", { phase: "nodes" satisfies SSEPhase, nodeIds: lensIds });
  const run = await runNodes(lensIds, required, req.input, req.summary, {
    env: deps.env,
    collector,
    nodeTimeoutMs: deps.nodeTimeoutMs,
    signal: deps.signal,
    onNodeComplete: (n) => emit("node", toNodeView(n)),
  });

  // ③ 掘る統合(token 逐次) or フォールバック
  emit("phase", { phase: "synth" satisfies SSEPhase });
  const onToken = (t: string) => emit("token", { t });
  // 境界の正直さ: 苦手系は回答冒頭に但し書きを先出しする(ストリームでも最初に見える)
  const boundary = detectBoundary(req.input);
  if (boundary) emit("token", { t: `${boundaryPrefix(boundary)}\n\n` });
  const synth = run.fallback
    ? await synthesizeFallbackStream(
        req.input,
        req.summary,
        { env: deps.env, collector, signal: deps.signal, careTurns: req.careTurns },
        onToken,
      )
    : await synthesizeStream(
        req.input,
        req.summary,
        run.nodes,
        { env: deps.env, collector, signal: deps.signal, careTurns: req.careTurns },
        onToken,
      );

  // ④ 検証
  emit("phase", { phase: "verify" satisfies SSEPhase });
  const verified = await verify(synth.answer, {
    env: deps.env,
    collector,
    signal: deps.signal,
  });
  // 部分的な劣化は握りつぶさず meta.warnings で可視化する
  if (synth.truncated) warnings.push("synth_truncated");
  if (synth.rescuedChars) warnings.push(`synth_text_after_marker: ${synth.rescuedChars}`);
  if (verified.rejected) warnings.push(`verifier_rewrite_rejected: ${verified.rejected}`);
  // 最終整形(入力に無い引用の除去・記号の乱れの修正)
  const care = detectCare(req.input);
  const polished = polishAnswer(verified.text, req.input, { dropOpeningQuote: care !== null });
  warnings.push(...polished.fixes);
  // 共鳴は実際に使えた腕同士でなければ出さない(起動していない腕を Living Core で光らせない)
  const resonance = validResonance(synth.resonance, run.nodes);
  if (synth.resonance && !resonance) warnings.push("resonance_dropped: lens_not_active");

  const quorumStr = `${run.successCount}/${run.nodes.length}`;

  // ⑤ 原価ログ + クォータ
  let quotaUsed: number | null = null;
  try {
    await logCost(
      deps.env.OCTO_KV,
      deps.requestId,
      collector,
      { quorum: quorumStr, fallback: run.fallback, ms: Date.now() - started, kind: "analyze" },
      deps.now,
    );
  } catch (err) {
    warnings.push(`cost_log_failed: ${errMsg(err)}`);
  }
  try {
    quotaUsed = await incrementQuota(
      deps.env.OCTO_KV,
      req.clientId,
      deps.now,
      QUOTA_UNITS[req.plan],
    );
  } catch (err) {
    warnings.push(`quota_increment_failed: ${errMsg(err)}`);
  }

  const meta: AnalyzeMeta = {
    plan: req.plan,
    domain,
    quorum: quorumStr,
    fallback: run.fallback,
    // 繊細な相談(寄り添いモード)では、深掘り・掛け合わせの提案を出さない
    tension: care ? null : synth.tension,
    resonance: care ? null : resonance,
    verified: verified.modified ? "modified" : "pass",
    totalCost: collector.totalCost(),
    ms: Date.now() - started,
    quotaUsed,
    boundary,
  };
  if (warnings.length > 0) meta.warnings = warnings;
  if (deps.economy) meta.economy = true;
  if (care) meta.care = care;
  if (shouldOfferSupport(care, req.careTurns ?? 0, polished.text)) meta.careOffer = true;

  // ⑥ done(一括JSONと同形)。answer は但し書きを前置きした最終テキスト
  emit("done", {
    answer: withBoundaryPrefix(polished.text, boundary),
    summary: synth.summary,
    nodes: run.nodes.map(toNodeView),
    meta,
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
