// 分析パイプライン全体 (docs/01_depth_design.md §6, docs/00_architecture.md §1)。
// Router(ドメイン) → プラン別レンズ並列 → 掘る統合 or フォールバック → 検証 → 原価ログ。
// HTTP関心 (バリデーション/JSON) は index.ts 側。ここは検証済み入力を受けて実行する。

import { classifyDomain } from "./router.js";
import { runNodes } from "./runNodes.js";
import { synthesize, synthesizeFallback, validResonance } from "./synthesize.js";
import { verify } from "./verify.js";
import { polishAnswer } from "./polish.js";
import { detectCare, type CareKind } from "./care.js";
import { CostCollector, incrementQuota, logCost, logFailedCost } from "./costlog.js";
import { QUOTA_UNITS } from "./guard.js";
import { detectBoundary, withBoundaryPrefix, type BoundaryKind } from "./boundary.js";
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
  // 予算逼迫で軽いモードに落として答えている(meta.economy に出す)
  economy?: boolean;
}

export interface AnalyzeNodeView {
  id: string;
  status: NodeResult["status"];
  opinions: Opinion[];
  // 部分失敗の可視化用。null は正常。API レスポンスに必ず含める。
  flag: NodeResult["flag"];
}

export function toNodeView(n: NodeResult): AnalyzeNodeView {
  return { id: n.id, status: n.status, opinions: n.opinions, flag: n.flag };
}

export interface AnalyzeMeta {
  // 予算逼迫のため軽いモード(ライト・推論なし)で答えた
  economy?: boolean;
  // 繊細な相談として寄り添いモードで答えた(アプリは視点一覧・深掘りを隠し、窓口を回答の後に添える)
  care?: CareKind;
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
  boundary?: BoundaryKind | null; // 正直な但し書きを添えた領域(計算/最新情報)。null は無し
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
  const collector = new CostCollector();
  try {
    return await runAnalyzeInner(req, deps, collector);
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

async function runAnalyzeInner(
  req: AnalyzeInput,
  deps: AnalyzeDeps,
  collector: CostCollector,
): Promise<AnalyzeResponse> {
  const started = deps.now.getTime();
  const warnings: string[] = [];

  // ① Router: ドメイン分類(light の軸選択 + meta 表示)
  // signal を渡し、リクエスト予算超過で router が宙吊りにならないようにする(P5)。
  const domain = await classifyDomain(req.input, {
    env: deps.env,
    collector,
    signal: deps.signal,
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
  // 部分的な劣化は握りつぶさず meta.warnings で可視化する
  if (synth.truncated) warnings.push("synth_truncated");
  if (synth.rescuedChars) warnings.push(`synth_text_after_marker: ${synth.rescuedChars}`);
  if (verified.rejected) warnings.push(`verifier_rewrite_rejected: ${verified.rejected}`);
  // 共鳴は実際に使えた腕同士でなければ出さない(起動していない腕を Living Core で光らせない)
  const resonance = validResonance(synth.resonance, run.nodes);
  if (synth.resonance && !resonance) warnings.push("resonance_dropped: lens_not_active");

  // ④' 境界の正直さ: 苦手系(計算/最新情報)を検出したら回答冒頭に正直な但し書き
  const boundary = detectBoundary(req.input);
  // 最終整形(入力に無い引用の除去・記号の乱れの修正)
  const care = detectCare(req.input);
  const polished = polishAnswer(verified.text, req.input, { dropOpeningQuote: care !== null });
  warnings.push(...polished.fixes);
  const answer = withBoundaryPrefix(polished.text, boundary);

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

  return {
    answer,
    summary: synth.summary,
    nodes: run.nodes.map(toNodeView),
    meta,
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
