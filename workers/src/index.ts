import { Hono } from "hono";
import { cors } from "hono/cors";
import { callModel } from "./lib/callModel.js";
import type { ModelRole } from "./config/models.js";
import { MODELS } from "./config/models.js";
import { runAnalyze } from "./lib/analyze.js";
import type { AnalyzeMode, ChatMessage, Env } from "./types.js";

const VERSION = "0.0.0-p1";

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

// メイン分析エンドポイント (§9 P1契約: 一括JSON)
app.post("/api/analyze", async (c) => {
  let body: {
    input?: unknown;
    summary?: unknown;
    mode?: unknown;
    clientId?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  // 入力バリデーション (§P1)
  const input = typeof body.input === "string" ? body.input : "";
  if (input.length === 0) return c.json({ error: "input_required" }, 400);
  if (input.length > MAX_INPUT_LEN) {
    return c.json({ error: "input_too_long", max: MAX_INPUT_LEN }, 400);
  }
  const summary = typeof body.summary === "string" ? body.summary : "";
  if (summary.length > MAX_SUMMARY_LEN) {
    return c.json({ error: "summary_too_long", max: MAX_SUMMARY_LEN }, 400);
  }
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  if (clientId.length === 0) return c.json({ error: "clientId_required" }, 400);

  const mode = (typeof body.mode === "string" ? body.mode : "auto") as AnalyzeMode;
  if (!VALID_MODES.includes(mode)) {
    return c.json({ error: "invalid_mode", allowed: VALID_MODES }, 400);
  }

  try {
    const res = await runAnalyze(
      { input, summary, mode, clientId },
      { env: c.env, now: new Date(), requestId: crypto.randomUUID() },
    );
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

export default app;
