// 分析パイプライン全体 (docs/01_depth_design.md §6, docs/00_architecture.md §1)。
// Router(ドメイン) → プラン別レンズ並列 → 掘る統合 or フォールバック → 検証 → 原価ログ。
// HTTP関心 (バリデーション/JSON) は index.ts 側。ここは検証済み入力を受けて実行する。

import { classifyDomain } from "./router.js";
import { runNodes } from "./runNodes.js";
import { synthesize, synthesizeFallback } from "./synthesize.js";
import { verify } from "./verify.js";
import { CostCollector, incrementQuota, logCost } from "./costlog.js";
import { planLenses, planQuorum } from "../config/nodes.js";
import type {
  Domain,
  Env,
  NodeResult,
  Opinion,
  Plan,
  Resonance,
  Tension,
} from "../types.js";

export interface AnalyzeInput {
  input: string;
  summary: string;
  plan: Plan;
  clientId: string;
}

export interface AnalyzeDeps {
  env: Env;
  now: Date;
  requestId: string;
  nodeTimeoutMs?: number;
  // P5: リクエスト全体のタイムアウト予算。超過でモデル呼び出しを中断する。
  signal?: AbortSignal;
}

export interface AnalyzeNodeView {
  id: string;
  status: NodeResult["status"];
  opinions: Opinion[];
}

export interface AnalyzeMeta {
  plan: Plan;
  domain: Domain;
  quorum: string;
  fallback: boolean;
  tension: Tension | null;
  resonance: Resonance | null;
  verified: "pass" | "modified";
  totalCost: number;
  ms: number;
  quotaUsed: number | null;
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

  // ① Router: ドメイン分類(light の軸選択 + meta 表示)
  const domain = await classifyDomain(req.input, {
    env: deps.env,
    collector,
  });

  // ② プラン別レンズ並列 + クォーラム
  const lensIds = planLenses(req.plan, domain);
  const required = planQuorum(req.plan);
  const run = await runNodes(lensIds, required, req.input, req.summary, {
    env: deps.env,
    collector,
    nodeTimeoutMs: deps.nodeTimeoutMs,
    signal: deps.signal,
  });

  // ③ 掘る統合 or フォールバック
  const synth = run.fallback
    ? await synthesizeFallback(req.input, req.summary, {
        env: deps.env,
        collector,
        signal: deps.signal,
      })
    : await synthesize(req.input, req.summary, run.nodes, {
        env: deps.env,
        collector,
        signal: deps.signal,
      });

  // ④ 検証(表面のみ最小修正)
  const verified = await verify(synth.answer, {
    env: deps.env,
    collector,
    signal: deps.signal,
  });

  const quorumStr = `${run.successCount}/${run.nodes.length}`;

  // ⑤ 原価ログ + クォータ(KV)。失敗は握りつぶさず warnings に。
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
    resonance: synth.resonance,
    verified: verified.modified ? "modified" : "pass",
    totalCost: collector.totalCost(),
    ms: Date.now() - started,
    quotaUsed,
  };
  if (warnings.length > 0) meta.warnings = warnings;

  return {
    answer: verified.text,
    summary: synth.summary,
    nodes: run.nodes.map((n) => ({
      id: n.id,
      status: n.status,
      opinions: n.opinions,
    })),
    meta,
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
