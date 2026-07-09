import { Hono } from "hono";
import { cors } from "hono/cors";
import { callModel } from "./lib/callModel.js";
import type { ModelRole } from "./config/models.js";
import { MODELS } from "./config/models.js";
import { runAnalyze } from "./lib/analyze.js";
import { runAnalyzeStream } from "./lib/analyzeStream.js";
import { runDeepen, resolveAxis } from "./lib/deepen.js";
import { runResonate, validateResonancePair } from "./lib/resonate.js";
import type { ChatMessage, Env, Plan } from "./types.js";

const VERSION = "0.0.0-p1.6";

const MAX_INPUT_LEN = 4000;
const MAX_SUMMARY_LEN = 500;
const MAX_PRIOR_LEN = 8000;
const VALID_PLANS: Plan[] = ["light", "deep"];

const app = new Hono<{ Bindings: Env }>();

// CORS: 開発は localhost:5173、本番オリジンは環境変数 ALLOWED_ORIGIN で指定
app.use("/api/*", (c, next) => {
  const allowed = [
    "http://localhost:5173",
    ...(c.env.ALLOWED_ORIGIN ? [c.env.ALLOWED_ORIGIN] : []),
  ];
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : allowed[0]),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })(c, next);
});

// ヘルスチェック
app.get("/api/health", (c) => c.json({ ok: true, version: VERSION }));

// 開発用: モデル疎通確認。production では無効。
app.post("/api/dev/ping-model", async (c) => {
  if (c.env.ENVIRONMENT === "production") {
    return c.json({ error: "not_available_in_production" }, 404);
  }

  let body: { role?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const role = body.role;
  if (!role || !(role in MODELS)) {
    return c.json(
      { error: "invalid_role", allowed: Object.keys(MODELS) },
      400,
    );
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
  | { ok: true; value: { input: string; summary: string; plan: Plan; clientId: string } }
  | { ok: false; error: string; extra?: Record<string, unknown> };

function validateAnalyzeBody(body: unknown): ValidatedBody {
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

  // plan 省略時は light(無料・安全側 §6)
  const plan = (typeof b.plan === "string" ? b.plan : "light") as Plan;
  if (!VALID_PLANS.includes(plan)) {
    return { ok: false, error: "invalid_plan", extra: { allowed: VALID_PLANS } };
  }
  return { ok: true, value: { input, summary, plan, clientId } };
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

  try {
    const res = await runAnalyze(v.value, {
      env: c.env,
      now: new Date(),
      requestId: crypto.randomUUID(),
    });
    return c.json(res);
  } catch (err) {
    // パイプライン全体の失敗は握りつぶさず可視化する
    return c.json(
      {
        error: "pipeline_error",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
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

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  const emit = (event: string, data: unknown): void => {
    void writer.write(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    );
  };

  const pump = async (): Promise<void> => {
    try {
      await runAnalyzeStream(
        v.value,
        { env: c.env, now: new Date(), requestId: crypto.randomUUID() },
        emit,
      );
    } catch (err) {
      emit("error", {
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      await writer.close();
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

  try {
    const res = await runDeepen(
      { input, summary, tension: { axis: axisText }, priorAnswer, clientId },
      { env: c.env, now: new Date(), requestId: crypto.randomUUID() },
    );
    return c.json(res);
  } catch (err) {
    return c.json(
      {
        error: "deepen_error",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
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
  const priorAnswer = typeof b.priorAnswer === "string" ? b.priorAnswer : "";
  if (priorAnswer.length > MAX_PRIOR_LEN) {
    return c.json({ error: "priorAnswer_too_long", max: MAX_PRIOR_LEN }, 400);
  }

  // lens(実在NodeId)・claim(120字以内)・a≠b の検証 (§4)
  const v = validateResonancePair(b.resonance);
  if (!v.ok) return c.json({ error: v.error }, 400);

  try {
    const res = await runResonate(
      { input, summary, resonance: { a: v.a, b: v.b }, priorAnswer, clientId },
      { env: c.env, now: new Date(), requestId: crypto.randomUUID() },
    );
    return c.json(res);
  } catch (err) {
    return c.json(
      {
        error: "resonate_error",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});

export default app;
