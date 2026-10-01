// 分析パイプライン全体 (docs/01_depth_design.md §6, docs/00_architecture.md §1)。
// Router(ドメイン) → プラン別レンズ並列 → 掘る統合 or フォールバック → 検証 → 原価ログ。
// HTTP関心 (バリデーション/JSON) は index.ts 側。ここは検証済み入力を受けて実行する。

import { classifyDomain } from "./router.js";
import { runNodes } from "./runNodes.js";
import { synthesize, synthesizeFallback, validResonance, validMap } from "./synthesize.js";
import { verify } from "./verify.js";
import { polishAnswer } from "./polish.js";
import { runMapper } from "./mapper.js";
import { pickWorlds, worldsEnabled } from "./worlds.js";
import { citedSources, researchEnabled, runResearch, type ResearchResult, type ResearchSource } from "./research.js";
import { answerLanguage } from "./language.js";
import { shouldOfferSupport, detectCare, type CareKind } from "./care.js";
import { CostCollector, incrementQuotaState, logCost, logFailedCost } from "./costlog.js";
import { QUOTA_UNITS, quotaStatus, type QuotaStatus } from "./guard.js";
import { detectBoundary, withBoundaryPrefix, type BoundaryKind } from "./boundary.js";
import { planLenses, planQuorum } from "../config/nodes.js";
import type {
  Domain,
  Env,
  NodeResult,
  Opinion,
  Plan,
  PerspectiveMap,
  Resonance,
  Tension,
} from "../types.js";

export interface AnalyzeInput {
  input: string;
  summary: string;
  plan: Plan;
  clientId: string;
  // この会話で寄り添いモードになった回数(窓口を出すかの判断に使う)
  careTurns?: number;
  // 直前の回答(統合脳だけが参照する)
  prevAnswer?: string;
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
  // 世界つきで探求したときだけ(立った世界・その世界の見方・実際の情報)
  world?: string;
  experience?: string;
  facts?: NodeResult["facts"];
  move?: string;
}

export function toNodeView(n: NodeResult): AnalyzeNodeView {
  return {
    id: n.id,
    status: n.status,
    opinions: n.opinions,
    flag: n.flag,
    ...(n.world ? { world: n.world } : {}),
    ...(n.experience ? { experience: n.experience } : {}),
    ...(n.facts ? { facts: n.facts } : {}),
    ...(n.move ? { move: n.move } : {}),
  };
}

// 起動する腕の数(= 選ぶ世界の数)。ドメインに依らずプランで決まる
export function planWorldCount(plan: Plan): number {
  return plan === "deep" ? 8 : 4;
}

// 回答が使った資料だけを meta.sources に載せる(使わなかった資料を出典のように見せない)
export function sourcesMeta(
  answer: string,
  sources: ResearchSource[] | undefined,
): { sources?: { kind: ResearchSource["kind"]; title: string; url: string }[] } {
  const used = citedSources(answer, sources ?? []);
  return used.length > 0 ? { sources: used.map((s) => ({ kind: s.kind, title: s.title, url: s.url })) } : {};
}

// ウェブ検索で最新の資料が取れたなら「最新情報は持っていない」の但し書きは付けない
export function boundaryAfterResearch(
  boundary: BoundaryKind | null,
  sources: ResearchSource[] | undefined,
): BoundaryKind | null {
  return boundary === "recency" && sources?.some((s) => s.kind === "web") ? null : boundary;
}

// 腕が立つ世界を選ぶか(設定がオンで、寄り添いモードでないとき)。
// 繊細な相談では、別の世界の話を持ち込まず本人に向き合う
export function shouldPickWorlds(env: Env, input: string): boolean {
  return worldsEnabled(env) && detectCare(input) === null;
}

export interface AnalyzeMeta {
  // 予算逼迫のため軽いモード(ライト・推論なし)で答えた
  economy?: boolean;
  // 視点の地図(合意の強さ・割れたところ・ひとつだけの指摘)。寄り添いモードでは出さない
  map?: PerspectiveMap | null;
  // 繊細な相談として寄り添いモードで答えた(アプリは視点一覧・深掘りを隠す)
  care?: CareKind;
  // 声で話せる場所(相談窓口)を添えてよい(アプリはこのときだけ窓口カードを出す)
  careOffer?: boolean;
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
  // 利用状況(残り回数の表示用)。KV 失敗時は付かない
  quota?: QuotaStatus;
  boundary?: BoundaryKind | null; // 正直な但し書きを添えた領域(計算/最新情報)。null は無し
  // 探求のしかた(explore: 違う世界から探求 / check: 法律・事実を全腕で照合)。世界の選定をしたときだけ
  inquiry?: "explore" | "check";
  // 調べて確かめた資料(法令・百科事典・ウェブ)。アプリは回答の下に出典として出す
  sources?: { kind: ResearchSource["kind"]; title: string; url: string }[];
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
  // 腕が立つ世界の選定はドメイン分類と並列に行う(待ち時間を増やさない)
  const [domain, plan] = await Promise.all([
    classifyDomain(req.input, { env: deps.env, collector, signal: deps.signal }),
    shouldPickWorlds(deps.env, req.input)
      ? pickWorlds(req.input, planWorldCount(req.plan), { env: deps.env, collector, signal: deps.signal })
      : Promise.resolve(null),
  ]);

  const worlds = plan?.worlds ?? null;
  // 照合モード(法律・事実の質問): 世界を立てず、資料を見ながら全腕が独立に確かめる
  const check = plan?.mode === "check";
  // 調べもの(公的・公開の情報源)は腕の探求と並列に進め、統合の前に受け取る
  const researchPromise =
    plan?.research && researchEnabled(deps.env)
      ? runResearch(plan.research, { env: deps.env, lang: answerLanguage(req.input), signal: deps.signal })
      : Promise.resolve(null);

  // ② プラン別レンズ並列 + クォーラム
  const lensIds = planLenses(req.plan, domain);
  const required = planQuorum(req.plan);
  // 照合モードでは資料を腕にも見せるため、腕の前に受け取る(探求モードは腕と並列)
  let research: ResearchResult | null = check ? await researchPromise : null;
  const run = await runNodes(lensIds, required, req.input, req.summary, {
    env: deps.env,
    collector,
    nodeTimeoutMs: deps.nodeTimeoutMs,
    signal: deps.signal,
    worlds,
    check,
    research: research?.sources,
  });

  // 調べものを受け取る(失敗は回答を止めず warnings で可視化)。照合モードでは腕の前に受け取り済み
  if (!check) research = await researchPromise;
  if (research?.failures.length) warnings.push(`research_failed: ${research.failures.join(",")}`);

  // ③ 掘る統合 or フォールバック
  // 視点の地図は統合脳と並列に作る(待ち時間を増やさない)。寄り添いモードでは作らない
  // 世界の選定が「迷いや判断を含まない相談」と判断した(空配列)ときも地図は作らない
  const mapPromise = detectCare(req.input) || (worlds !== null && worlds.length === 0 && !check)
    ? Promise.resolve(null)
    : runMapper(req.input, run.nodes, {
        env: deps.env,
        collector,
        signal: deps.signal,
        check,
        onFailure: (reason) => warnings.push(`map_failed: ${reason}`),
      });
  const synth = run.fallback
    ? await synthesizeFallback(req.input, req.summary, {
        env: deps.env,
        collector,
        signal: deps.signal,
        careTurns: req.careTurns, prevAnswer: req.prevAnswer, research: research?.sources, check,
      })
    : await synthesize(req.input, req.summary, run.nodes, {
        env: deps.env,
        collector,
        signal: deps.signal,
        careTurns: req.careTurns, prevAnswer: req.prevAnswer, research: research?.sources, check,
      });

  // ④ 検証(表面のみ最小修正)
  // 地図役の完了を待つ(原価ログに地図役の呼び出しも確実に入るよう、記録より前で)
  const mapRaw = await mapPromise;
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
  const boundary = boundaryAfterResearch(detectBoundary(req.input), research?.sources);
  // 最終整形(入力に無い引用の除去・記号の乱れの修正)
  const care = detectCare(req.input);
  const polished = polishAnswer(verified.text, req.input, { dropOpeningQuote: care !== null });
  warnings.push(...polished.fixes);
  const answer = withBoundaryPrefix(polished.text, boundary);

  const quorumStr = `${run.successCount}/${run.nodes.length}`;

  // ⑤ 原価ログ + クォータ(KV)。失敗は握りつぶさず warnings に。
  let quotaUsed: number | null = null;
  let quota: QuotaStatus | null = null;
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
    const qv = await incrementQuotaState(
      deps.env.OCTO_KV,
      req.clientId,
      deps.now,
      QUOTA_UNITS[req.plan],
    );
    quotaUsed = qv.month;
    quota = quotaStatus(deps.env, qv);
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
    map: care ? null : validMap(mapRaw ?? synth.map, run.nodes),
    verified: verified.modified ? "modified" : "pass",
    totalCost: collector.totalCost(),
    ms: Date.now() - started,
    quotaUsed,
    ...(quota ? { quota } : {}),
    boundary,
    ...(plan ? { inquiry: plan.mode } : {}),
    ...sourcesMeta(polished.text, research?.sources),
  };
  if (warnings.length > 0) meta.warnings = warnings;
  if (deps.economy) meta.economy = true;
  if (care) meta.care = care;
  if (shouldOfferSupport(care, req.careTurns ?? 0, polished.text)) meta.careOffer = true;

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
