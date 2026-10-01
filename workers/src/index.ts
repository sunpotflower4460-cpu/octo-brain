import { Hono } from "hono";
import { cors } from "hono/cors";
import { callModel } from "./lib/callModel.js";
import type { ModelRole } from "./config/models.js";
import { BASELINE_MODELS, MODEL_ROLES, activeProfile, modelFor } from "./config/models.js";
import { CostCollector } from "./lib/costlog.js";
import { runAnalyze } from "./lib/analyze.js";
import { runAnalyzeStream } from "./lib/analyzeStream.js";
import { runDeepen, resolveAxis } from "./lib/deepen.js";
import { runResonate, validateResonancePair } from "./lib/resonate.js";
import {
  acquireSlot,
  releaseSlot,
  checkQuota,
  checkDailyBudget,
  dailyQuotaLimit,
  type BudgetMode,
  peekIpQuota,
  addIpQuota,
  deepPlanEnabled,
  isValidClientId,
  quotaLimit,
  QUOTA_UNITS,
  DEFAULT_IP_DAILY_QUOTA,
  type QuotaKind,
  requestBudgetMs,
  numEnv,
  DEFAULT_MIN_INTERVAL_MS,
  DEFAULT_LOCK_MS,
} from "./lib/guard.js";
import { combineAbortSignals } from "./lib/abort.js";
import type { Context } from "hono";
import type { ChatMessage, Env, Plan } from "./types.js";
import { legalPage } from "./legal/render.js";
import privacyMd from "../legal/privacy_policy.md";
import termsMd from "../legal/terms_of_use.md";
import supportMd from "../legal/support.md";

const VERSION = "0.0.0-p5";

const MAX_INPUT_LEN = 4000;
const MAX_SUMMARY_LEN = 500;
const MAX_PRIOR_LEN = 8000;
const MAX_PREV_ANSWER_LEN = 2000;
const VALID_PLANS: Plan[] = ["light", "deep"];

const app = new Hono<{ Bindings: Env }>();

// ログ用のエラー詳細。上流の応答本文にキーらしき文字列が混ざっても伏せる。
function errDetail(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\b(sk|key|token)[-_A-Za-z0-9]{8,}/gi, "$1-***");
}

// CORS: 開発は localhost:5173、Capacitor(iOS/Android WebView)は localhost 系オリジン、
// 本番オリジンは環境変数 ALLOWED_ORIGIN で指定。
app.use("/api/*", (c, next) => {
  const allowed = [
    "capacitor://localhost", // iOS WKWebView (Capacitor 既定オリジン)
    "http://localhost", // Android WebView
    "https://localhost", // 一部の WKWebView 構成
    // Vite dev はローカル開発時のみ(本番に開発用オリジンを残さない)
    ...(c.env.ENVIRONMENT === "development" ? ["http://localhost:5173"] : []),
    ...(c.env.ALLOWED_ORIGIN ? [c.env.ALLOWED_ORIGIN] : []),
  ];
  return cors({
    // 未許可オリジンには Access-Control-Allow-Origin を付けない(ブラウザが拒否する)
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })(c, next);
});

// リクエスト本文の上限。JSON を読む前に Content-Length で弾く(巨大な本文でのメモリ・CPU 消費を防ぐ)。
// 正規の最大は input 4000 + summary 500 + priorAnswer 8000 字程度(UTF-8 で約40KB)。
const MAX_BODY_BYTES = 64 * 1024;
app.use("/api/*", async (c, next) => {
  if (c.req.method === "POST") {
    const len = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
      return c.json({ error: "payload_too_large", max: MAX_BODY_BYTES }, 413);
    }
  }
  await next();
});

// 法務文書・サポート(App Store Connect のプライバシーポリシーURL / サポートURL)。
// 正本は workers/legal/*.md。デプロイで反映される。
const LEGAL_PAGES: Record<string, { title: string; md: string }> = {
  "/legal/privacy": { title: "プライバシーポリシー — OctoBrain", md: privacyMd },
  "/legal/terms": { title: "利用規約 — OctoBrain", md: termsMd },
  "/support": { title: "サポート — OctoBrain", md: supportMd },
};
for (const [path, page] of Object.entries(LEGAL_PAGES)) {
  app.get(path, (c) =>
    c.html(legalPage(page.title, page.md), 200, {
      "cache-control": "public, max-age=300",
    }),
  );
}

// ヘルスチェック
// 設定不備(モデル未設定・APIキー未登録・KV 未接続)を 503 で知らせ、監視で検知できるようにする。
// キーの値や環境変数名は返さない(役割名のみ)。
app.get("/api/health", (c) => {
  const problems: string[] = [];
  const profile = activeProfile(c.env);
  for (const role of MODEL_ROLES) {
    const cfg = modelFor(role, c.env);
    if (cfg.model.includes("SET_ME") || (cfg.baseURL ?? "").includes("SET_ME")) {
      problems.push(`${role}:model_not_configured`);
    }
    const key = c.env[cfg.keyEnv];
    if (typeof key !== "string" || key.length === 0) problems.push(`${role}:api_key_missing`);
  }
  if (!c.env.OCTO_KV) problems.push("kv_missing");
  if (problems.length > 0) return c.json({ ok: false, version: VERSION, profile, problems }, 503);
  return c.json({ ok: true, version: VERSION, profile });
});

// 開発用: 比較評価の「普通のチャットボット」。ENVIRONMENT=development のときだけ有効。
// body: { model: "luna" | "sol" | "pro", system?: string, input: string }。原価は callModel を通る(絶対ルール5)。
app.post("/api/dev/baseline", async (c) => {
  if (c.env.ENVIRONMENT !== "development") {
    return c.json({ error: "not_available_in_production" }, 404);
  }
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const model = b.model === "sol" || b.model === "pro" ? b.model : "luna";
  const input = typeof b.input === "string" ? b.input : "";
  const system =
    typeof b.system === "string" && b.system.length > 0
      ? b.system
      : "あなたは親切で有能なAIアシスタントです。ユーザーの相談や質問に、日本語で丁寧かつ具体的に答えてください。";
  if (input.length === 0) return c.json({ error: "input_required" }, 400);
  try {
    const collector = new CostCollector();
    const r = await callModel(
      "synth",
      [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
      { env: c.env, modelOverride: BASELINE_MODELS[model], collector },
    );
    return c.json({ text: r.text, cost: collector.totalCost(), ms: r.ms });
  } catch (err) {
    return c.json({ error: errDetail(err) }, 502);
  }
});

// 開発用: モデル疎通確認。ENVIRONMENT=development のときだけ有効(未設定・本番は無効)。
app.post("/api/dev/ping-model", async (c) => {
  if (c.env.ENVIRONMENT !== "development") {
    return c.json({ error: "not_available_in_production" }, 404);
  }

  let body: { role?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const role = body.role;
  if (!role || !MODEL_ROLES.includes(role as ModelRole)) {
    return c.json({ error: "invalid_role", allowed: MODEL_ROLES }, 400);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: "pong とだけ返せ。他の文字は一切出力するな。" },
    { role: "user", content: "ping" },
  ];

  try {
    const result = await callModel(role as ModelRole, messages, {
      env: c.env,
    });
    return c.json({
      ok: true,
      role,
      text: result.text,
      inTok: result.inTok,
      outTok: result.outTok,
      ms: result.ms,
      estimated: result.estimated,
    });
  } catch (err) {
    return c.json(
      { ok: false, role, error: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
});

// 入力バリデーション。/api/analyze と /api/analyze/stream で共通。
type ValidatedBody =
  | {
      ok: true;
      value: {
        input: string;
        summary: string;
        plan: Plan;
        clientId: string;
        careTurns: number;
        prevAnswer: string;
      };
    }
  | { ok: false; error: string; extra?: Record<string, unknown> };

export function validateAnalyzeBody(body: unknown): ValidatedBody {
  const b = (body ?? {}) as Record<string, unknown>;
  const input = typeof b.input === "string" ? b.input : "";
  if (input.length === 0) return { ok: false, error: "input_required" };
  if (input.length > MAX_INPUT_LEN) {
    return { ok: false, error: "input_too_long", extra: { max: MAX_INPUT_LEN } };
  }
  const summary = typeof b.summary === "string" ? b.summary : "";
  if (summary.length > MAX_SUMMARY_LEN) {
    return { ok: false, error: "summary_too_long", extra: { max: MAX_SUMMARY_LEN } };
  }
  const clientId = typeof b.clientId === "string" ? b.clientId : "";
  if (clientId.length === 0) return { ok: false, error: "clientId_required" };
  if (!isValidClientId(clientId)) return { ok: false, error: "invalid_clientId" };

  // plan 省略時は light(無料・安全側 §6)
  const plan = (typeof b.plan === "string" ? b.plan : "light") as Plan;
  if (!VALID_PLANS.includes(plan)) {
    return { ok: false, error: "invalid_plan", extra: { allowed: VALID_PLANS } };
  }
  // この会話で寄り添いモードになった回数(アプリが数えて送る)。窓口を控えめに出す判断にだけ使う
  const rawTurns = typeof b.careTurns === "number" ? Math.floor(b.careTurns) : 0;
  const careTurns = Math.min(100, Math.max(0, Number.isFinite(rawTurns) ? rawTurns : 0));
  // 直前の回答(統合脳だけが参照)。長すぎる分は末尾を切る(原価の上限を保つ)
  const prevAnswer = typeof b.prevAnswer === "string" ? b.prevAnswer.slice(0, MAX_PREV_ANSWER_LEN) : "";
  return { ok: true, value: { input, summary, plan, clientId, careTurns, prevAnswer } };
}

// ---- P5 堅牢化ガード: IP制限 + 連打防止 + クォータ実ブロック ----
// 全モデル呼び出しエンドポイントの入口で共通に使う。ブロック時は 429 を返す。
// clientId はクライアント生成で使い捨て可能なため、IP 単位の天井(バースト+1日上限)を重ねる。
// release() は処理完了後に必ず呼ぶ(finally)。同時実行ロックを解放する。
interface GuardResult {
  blocked: Response | null;
  release: () => Promise<void>;
  // 予算の逼迫度。economy なら呼び出し側で軽いモードに落とす
  mode: BudgetMode;
}

// 予算逼迫時(economy)の env: 統合脳の推論を切って原価を下げる
function economyEnv(env: Env): Env {
  return { ...env, LUNA_SYNTH_REASONING: "none" };
}

async function guardRequest(
  c: Context<{ Bindings: Env }>,
  clientId: string,
  kind: QuotaKind,
): Promise<GuardResult> {
  const env = c.env;
  const kv = env.OCTO_KV;
  const nowMs = Date.now();
  const noRelease = async (): Promise<void> => {};
  const units = QUOTA_UNITS[kind];
  // Cloudflare 本番では常に付与される。ローカル/テストで無い場合は IP 制限をスキップ
  const ip = c.req.header("CF-Connecting-IP") ?? "";

  const now = new Date(nowMs);
  const ipLimit = numEnv(env, "IP_DAILY_QUOTA", DEFAULT_IP_DAILY_QUOTA);

  // KV の読み取りは 1 回あたり数百 ms かかるので、独立した判定はすべて並列に行う
  // (以前は順番に実行しており、最初の応答まで約 2 秒かかっていた)。
  // 連打防止のスロットは先に確保し、ほかで弾かれたら解放する。
  const [daily, burst, slot, q, ipq] = await Promise.all([
    checkDailyBudget(kv, env, now),
    ip && env.IP_RATE_LIMITER
      ? env.IP_RATE_LIMITER.limit({ key: ip })
      : Promise.resolve({ success: true }),
    acquireSlot(kv, clientId, nowMs, {
      minIntervalMs: numEnv(env, "MIN_INTERVAL_MS", DEFAULT_MIN_INTERVAL_MS),
      lockMs: DEFAULT_LOCK_MS,
    }),
    checkQuota(kv, clientId, now, quotaLimit(env), units, dailyQuotaLimit(env)),
    ip ? peekIpQuota(kv, ip, now, ipLimit) : Promise.resolve(null),
  ]);

  const release = async (): Promise<void> => {
    await releaseSlot(kv, clientId, Date.now());
  };
  // 弾くときは、確保できていたスロットを解放してから返す
  const block = async (res: Response): Promise<GuardResult> => {
    if (slot.ok) await release();
    return { blocked: res, release: noRelease, mode: "normal" };
  };

  // 判定の優先順: 全体予算 → IP バースト → 連打防止 → 月間クォータ → IP の1日上限
  if (!daily.allowed) {
    return block(c.json({ error: "daily_budget_exceeded" }, 503, { "Retry-After": "3600" }));
  }
  if (!burst.success) {
    return block(
      c.json({ error: "ip_rate_limited", retryAfterMs: 60_000 }, 429, { "Retry-After": "60" }),
    );
  }
  if (!slot.ok) {
    const retryAfterSec = Math.max(1, Math.ceil(slot.retryAfterMs / 1000));
    return {
      blocked: c.json({ error: slot.error, retryAfterMs: slot.retryAfterMs }, 429, {
        "Retry-After": String(retryAfterSec),
      }),
      release: noRelease,
      mode: "normal",
    };
  }
  if (!q.allowed) {
    return block(c.json({ error: "quota_exceeded", limit: q.limit, used: q.used, units }, 429));
  }
  if (!q.dayAllowed) {
    // 1人の1日上限。共有の予算を少数の利用者が使い切らないようにする
    return block(
      c.json({ error: "daily_quota_exceeded", limit: q.dayLimit, used: q.dayUsed, units }, 429),
    );
  }
  if (ipq && !ipq.allowed) {
    return block(c.json({ error: "ip_quota_exceeded" }, 429));
  }

  // 受理: IP の1日上限に今回分を加算(受理時点で数える=失敗リクエストも含む)
  if (ip && ipq) await addIpQuota(kv, ip, now, ipq.used, units);

  return { blocked: null, release, mode: daily.mode };
}

// メイン分析エンドポイント (§9 P1契約: 一括JSON)。ベンチ(P3)でも使う。
app.post("/api/analyze", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const v = validateAnalyzeBody(body);
  if (!v.ok) return c.json({ error: v.error, ...v.extra }, 400);
  if (v.value.plan === "deep" && !deepPlanEnabled(c.env)) {
    return c.json({ error: "plan_not_available", plan: "deep" }, 403);
  }

  const guard = await guardRequest(c, v.value.clientId, v.value.plan);
  if (guard.blocked) return guard.blocked;

  const budget = AbortSignal.timeout(requestBudgetMs(c.env));
  // クライアント切断でもモデル呼び出しを止め、無駄な原価・クォータ消化を防ぐ。
  const signal = combineAbortSignals(budget, c.req.raw.signal);
  try {
    // 予算逼迫時は deep もライトで答え、統合脳の推論を切る(meta.economy で利用者に伝える)
    const economy = guard.mode === "economy";
    const res = await runAnalyze(economy ? { ...v.value, plan: "light" } : v.value, {
      env: economy ? economyEnv(c.env) : c.env,
      now: new Date(),
      requestId: crypto.randomUUID(),
      signal,
      economy,
    });
    return c.json(res);
  } catch (err) {
    // クライアント切断は応答不要(接続済み切断)。予算超過のみ 504。
    if (c.req.raw.signal.aborted) {
      return c.body(null);
    }
    if (budget.aborted) {
      return c.json({ error: "timeout", budgetMs: requestBudgetMs(c.env) }, 504);
    }
    console.error("analyze pipeline_error", errDetail(err));
    return c.json({ error: "pipeline_error" }, 500);
  } finally {
    await guard.release();
  }
});

// ストリーミング分析エンドポイント (§9 P2: SSE)。
app.post("/api/analyze/stream", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const v = validateAnalyzeBody(body);
  if (!v.ok) return c.json({ error: v.error, ...v.extra }, 400);
  if (v.value.plan === "deep" && !deepPlanEnabled(c.env)) {
    return c.json({ error: "plan_not_available", plan: "deep" }, 403);
  }

  // 連打防止 + クォータは stream 開始前に判定する(429 をそのまま返せる)
  const guard = await guardRequest(c, v.value.clientId, v.value.plan);
  if (guard.blocked) return guard.blocked;

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  // 書き込み失敗 = クライアントが読むのをやめた(切断・停止)。以降のモデル呼び出しを止める。
  // request.signal(enable_request_signal)と二重に検知し、どちらか早い方で中断する。
  const clientGone = new AbortController();
  const emit = (event: string, data: unknown): void => {
    if (clientGone.signal.aborted) return;
    writer
      .write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      .catch(() => clientGone.abort());
  };

  const budget = AbortSignal.timeout(requestBudgetMs(c.env));
  // クライアント切断でもモデル呼び出しを止め、無駄な原価・クォータ消化を防ぐ。
  const signal = combineAbortSignals(budget, c.req.raw.signal, clientGone.signal);
  const pump = async (): Promise<void> => {
    try {
      const economy = guard.mode === "economy";
      await runAnalyzeStream(
        economy ? { ...v.value, plan: "light" } : v.value,
        {
          env: economy ? economyEnv(c.env) : c.env,
          now: new Date(),
          requestId: crypto.randomUUID(),
          signal,
          economy,
        },
        emit,
      );
    } catch (err) {
      // 切断済みなら emit 不要。予算超過は構造化 error でフロントが humanize できる形に。
      if (c.req.raw.signal.aborted || clientGone.signal.aborted) return;
      if (budget.aborted) {
        emit("error", { error: "timeout", message: "timeout" });
        return;
      }
      // 上流の生エラー(プロバイダーの応答本文等)はクライアントに返さずログにだけ残す
      console.error("analyze/stream pipeline_error", errDetail(err));
      // 開発環境だけは原因を返す(評価・調査用。本番では返さない)
      emit("error", {
        error: "pipeline_error",
        ...(c.env.ENVIRONMENT === "development" ? { detail: errDetail(err).slice(0, 300) } : {}),
      });
    } finally {
      try {
        await writer.close();
      } catch {
        /* 既に閉じている場合は無視 */
      }
      await guard.release();
    }
  };

  // Worker がストリーム完了まで生存するように waitUntil で継続
  c.executionCtx.waitUntil(pump());

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
});

// 深化エンドポイント (P1.5 §6): 最緊張軸の対角2腕を再考させ中央脳が織り直す。
app.post("/api/deepen", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const input = typeof b.input === "string" ? b.input : "";
  if (input.length === 0) return c.json({ error: "input_required" }, 400);
  if (input.length > MAX_INPUT_LEN) {
    return c.json({ error: "input_too_long", max: MAX_INPUT_LEN }, 400);
  }
  const summary = typeof b.summary === "string" ? b.summary : "";
  if (summary.length > MAX_SUMMARY_LEN) {
    return c.json({ error: "summary_too_long", max: MAX_SUMMARY_LEN }, 400);
  }
  const clientId = typeof b.clientId === "string" ? b.clientId : "";
  if (clientId.length === 0) return c.json({ error: "clientId_required" }, 400);
  if (!isValidClientId(clientId)) return c.json({ error: "invalid_clientId" }, 400);
  const priorAnswer = typeof b.priorAnswer === "string" ? b.priorAnswer : "";
  if (priorAnswer.length > MAX_PRIOR_LEN) {
    return c.json({ error: "priorAnswer_too_long", max: MAX_PRIOR_LEN }, 400);
  }

  // tension.axis のガード: 既知の軸に解決できないと深化できない (§6 tension欠落ガード)
  const tension = (b.tension ?? {}) as Record<string, unknown>;
  const axisText = typeof tension.axis === "string" ? tension.axis : "";
  if (axisText.length === 0 || resolveAxis(axisText) === null) {
    return c.json({ error: "unknown_or_missing_tension", axis: axisText }, 400);
  }

  const guard = await guardRequest(c, clientId, "deepen");
  if (guard.blocked) return guard.blocked;

  const budget = AbortSignal.timeout(requestBudgetMs(c.env));
  const signal = combineAbortSignals(budget, c.req.raw.signal);
  try {
    const res = await runDeepen(
      { input, summary, tension: { axis: axisText }, priorAnswer, clientId },
      {
        env: guard.mode === "economy" ? economyEnv(c.env) : c.env,
        now: new Date(),
        requestId: crypto.randomUUID(),
        signal,
      },
    );
    return c.json(res);
  } catch (err) {
    if (c.req.raw.signal.aborted) return c.body(null);
    if (budget.aborted) {
      return c.json({ error: "timeout", budgetMs: requestBudgetMs(c.env) }, 504);
    }
    console.error("deepen deepen_error", errDetail(err));
    return c.json({ error: "deepen_error" }, 500);
  } finally {
    await guard.release();
  }
});

// 共鳴(掛け算)エンドポイント (P1.6 §4): 一見遠い2つの意見を掛け合わせ第三の選択肢を生む。
app.post("/api/resonate", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const input = typeof b.input === "string" ? b.input : "";
  if (input.length === 0) return c.json({ error: "input_required" }, 400);
  if (input.length > MAX_INPUT_LEN) {
    return c.json({ error: "input_too_long", max: MAX_INPUT_LEN }, 400);
  }
  const summary = typeof b.summary === "string" ? b.summary : "";
  if (summary.length > MAX_SUMMARY_LEN) {
    return c.json({ error: "summary_too_long", max: MAX_SUMMARY_LEN }, 400);
  }
  const clientId = typeof b.clientId === "string" ? b.clientId : "";
  if (clientId.length === 0) return c.json({ error: "clientId_required" }, 400);
  if (!isValidClientId(clientId)) return c.json({ error: "invalid_clientId" }, 400);
  const priorAnswer = typeof b.priorAnswer === "string" ? b.priorAnswer : "";
  if (priorAnswer.length > MAX_PRIOR_LEN) {
    return c.json({ error: "priorAnswer_too_long", max: MAX_PRIOR_LEN }, 400);
  }

  // lens(実在NodeId)・claim(120字以内)・a≠b の検証 (§4)
  const v = validateResonancePair(b.resonance);
  if (!v.ok) return c.json({ error: v.error }, 400);

  const guard = await guardRequest(c, clientId, "resonate");
  if (guard.blocked) return guard.blocked;

  const budget = AbortSignal.timeout(requestBudgetMs(c.env));
  const signal = combineAbortSignals(budget, c.req.raw.signal);
  try {
    const res = await runResonate(
      { input, summary, resonance: { a: v.a, b: v.b }, priorAnswer, clientId },
      {
        env: guard.mode === "economy" ? economyEnv(c.env) : c.env,
        now: new Date(),
        requestId: crypto.randomUUID(),
        signal,
      },
    );
    return c.json(res);
  } catch (err) {
    if (c.req.raw.signal.aborted) return c.body(null);
    if (budget.aborted) {
      return c.json({ error: "timeout", budgetMs: requestBudgetMs(c.env) }, 504);
    }
    console.error("resonate resonate_error", errDetail(err));
    return c.json({ error: "resonate_error" }, 500);
  } finally {
    await guard.release();
  }
});

export default app;
