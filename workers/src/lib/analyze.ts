// 分析パイプライン全体 (docs/00_architecture.md §1, §9)。
// Router → 並列ノード → 統合 or フォールバック → 検証 → 原価ログ/クォータ。
// HTTP関心 (バリデーション/JSON) は index.ts 側。ここは検証済み入力を受けて実行する。

import { classifyRoute } from "./router.js";
import { runNodes } from "./runNodes.js";
import { synthesize, synthesizeFallback } from "./synthesize.js";
import { verify } from "./verify.js";
import { CostCollector, incrementQuota, logCost } from "./costlog.js";
import type { AnalyzeMode, Env, NodeResult, Route } from "../types.js";

export interface AnalyzeInput {
  input: string;
  summary: string;
  mode: AnalyzeMode;
  clientId: string;
}

export interface AnalyzeDeps {
  env: Env;
  now: Date;
  requestId: string;
  nodeTimeoutMs?: number;
}

export interface AnalyzeNodeView {
  id: string;
  status: NodeResult["status"];
  points: string[];
  confidence: number;
}

export interface AnalyzeMeta {
  route: Route;
  quorum: string;
  fallback: boolean;
  verified: "pass" | "modified";
  totalCost: number;
  ms: number;
  quotaUsed: number | null;
  // 部分失敗を握りつぶさず可視化する (§技術規約)。KV書き込み失敗など。
  warnings?: string[];
}

export interface AnalyzeResponse {
  answer: string;
  summary: string;
  nodes: AnalyzeNodeView[];
  meta: AnalyzeMeta;
}

export async function runAnalyze(
  req: AnalyzeInput,
  deps: AnalyzeDeps,
): Promise<AnalyzeResponse> {
  const started = deps.now.getTime();
  const collector = new CostCollector();
  const warnings: string[] = [];

  // ① Router (mode 明示時はスキップ)
  const route: Route =
    req.mode === "auto"
      ? await classifyRoute(req.input, { env: deps.env, collector })
      : req.mode;

  // ② 並列ノード + クォーラム
  const run = await runNodes(route, req.input, req.summary, {
    env: deps.env,
    collector,
    nodeTimeoutMs: deps.nodeTimeoutMs,
  });

  // ③ 統合 or フォールバック
  const synth = run.fallback
    ? await synthesizeFallback(req.input, req.summary, {
        env: deps.env,
        collector,
      })
    : await synthesize(req.input, req.summary, run.nodes, {
        env: deps.env,
        collector,
      });

  // ④ 検証 (表面のみ最小修正)
  const verified = await verify(synth.answer, { env: deps.env, collector });

  const quorumStr = `${run.successCount}/${run.nodes.length}`;

  // ⑤ 原価ログ + クォータ (KV)。失敗は握りつぶさず warnings に載せる。
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
    quotaUsed = await incrementQuota(
      deps.env.OCTO_KV,
      req.clientId,
      deps.now,
    );
  } catch (err) {
    warnings.push(`quota_increment_failed: ${errMsg(err)}`);
  }

  const meta: AnalyzeMeta = {
    route,
    quorum: quorumStr,
    fallback: run.fallback,
    verified: verified.modified ? "modified" : "pass",
    totalCost: collector.totalCost(),
    ms: elapsed(started),
    quotaUsed,
  };
  if (warnings.length > 0) meta.warnings = warnings;

  return {
    answer: verified.text,
    summary: synth.summary,
    nodes: run.nodes.map((n) => ({
      id: n.id,
      status: n.status,
      points: n.points,
      confidence: n.confidence,
    })),
    meta,
  };
}

function elapsed(startedMs: number): number {
  return Date.now() - startedMs;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
