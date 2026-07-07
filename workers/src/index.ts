import { Hono } from "hono";
import { cors } from "hono/cors";
import { callModel } from "./lib/callModel.js";
import type { ModelRole } from "./config/models.js";
import { MODELS } from "./config/models.js";
import { runAnalyze } from "./lib/analyze.js";
import { runAnalyzeStream } from "./lib/analyzeStream.js";
import type { AnalyzeMode, ChatMessage, Env } from "./types.js";

const VERSION = "0.0.0-p2";

const MAX_INPUT_LEN = 4000;
const MAX_SUMMARY_LEN = 500;
const VALID_MODES: AnalyzeMode[] = ["auto", "simple", "normal", "complex"];

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

// 入力バリデーション (§P1)。両エンドポイント共通。
type ValidatedBody =
  | { ok: true; value: { input: string; summary: string; mode: AnalyzeMode; clientId: string } }
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

  const mode = (typeof b.mode === "string" ? b.mode : "auto") as AnalyzeMode;
  if (!VALID_MODES.includes(mode)) {
    return { ok: false, error: "invalid_mode", extra: { allowed: VALID_MODES } };
  }
  return { ok: true, value: { input, summary, mode, clientId } };
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

export default app;
