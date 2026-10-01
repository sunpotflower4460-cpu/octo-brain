// ============================================================================
// モデル抽象化レイヤー。
//
// 全てのLLM呼び出しはこの callModel() を経由する (CLAUDE.md 絶対ルール5)。
// provider ごとのリクエスト/レスポンス差異をここで吸収し、
// 呼び出し元は role とメッセージだけを意識すればよい状態にする。
//
// KVへの原価ログ書き込み自体は P1 の logCost に委ねる。
// この段階では原価ログに必要な素材 (inTok/outTok/ms/estimated) を戻り値で返すのみ。
// ============================================================================

import {
  fallbackFor,
  modelFor,
  estimateCost,
  type ModelConfig,
  type ModelRole,
} from "../config/models.js";
import type {
  RateLimitSnapshot,
  ChatMessage,
  CostSink,
  Env,
  ModelCallResult,
} from "../types.js";

export interface CallModelOpts {
  env: Env;
  maxTokens?: number;
  signal?: AbortSignal;
  modelOverride?: ModelConfig;
  // リトライのベース待機ms (指数バックオフ)。テストで 0 を渡せるよう外出し
  retryBaseMs?: number;
  // ストリーミング終了時の通知(出力上限での打ち切り検出用)。callModelStream のみ使用
  onStreamEnd?: (info: { truncated: boolean }) => void;
  // 原価ログの書き込み先。渡されると呼び出し1件分のレコードを record() する。
  // 全モデル呼び出しがこの1関数を経由して原価ログに載る (絶対ルール5)。
  collector?: CostSink;
}

const MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 250;

export async function callModel(
  role: ModelRole,
  messages: ChatMessage[],
  opts: CallModelOpts,
): Promise<ModelCallResult> {
  const primary = opts.modelOverride ?? modelFor(role, opts.env);
  const fallback = fallbackFor(role, opts.env, primary);
  try {
    // 切り替え先があるときは、混雑(429)での同じ相手への再試行を1回までにする
    // (1リクエストの外部呼び出し回数の上限を使い切らないため。ただし1回は待つ: 切り替え先の
    // DeepSeek は統合脳の単価が高く、すぐ切り替えると混雑時の原価が数倍になった)
    return await callWith(role, primary, messages, opts, false, fallback !== null);
  } catch (err) {
    // 混雑(429)・障害(5xx)・接続失敗なら、もう一方のプロバイダーで1回だけ試す
    const fb = shouldFallback(err) ? fallback : null;
    if (!fb) throw err;
    return await callWith(role, fb, messages, opts, true, false);
  }
}

// 主のプロバイダーを諦めてよいエラーか(中断や 4xx の入力不備では切り替えない)
export function shouldFallback(err: unknown): boolean {
  if (isAbortError(err)) return false;
  if (err instanceof ModelHttpError) return err.status === 429 || err.status >= 500;
  return true; // 接続失敗など
}

// HTTP ステータスを保持するエラー(切り替え判断用)
export class ModelHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ModelHttpError";
  }
}

async function callWith(
  role: ModelRole,
  cfg: ModelConfig,
  messages: ChatMessage[],
  opts: CallModelOpts,
  fellBack: boolean,
  noRetryOn429: boolean,
): Promise<ModelCallResult> {
  // 推論の予算は上書きされた上限にも上乗せする(推論で本文が空にならないように)
  const maxTokens = (opts.maxTokens ?? cfg.maxTokens) + (cfg.reasoningBudget ?? 0);
  const apiKey = readKey(opts.env, cfg.keyEnv);

  const req = buildRequest(cfg, messages, maxTokens, apiKey);

  const start = nowMs();
  const res = await fetchWithRetry(
    req.url,
    req.init,
    opts.signal,
    opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
    noRetryOn429,
  );
  const bodyText = await res.text();
  const ms = nowMs() - start;

  if (!res.ok) {
    throw new ModelHttpError(
      `callModel(${role}) HTTP ${res.status}: ${bodyText.slice(0, 300)}`,
      res.status,
    );
  }

  const parsed = safeJson(bodyText);
  const out = extractResult(cfg, parsed, messages);

  // 原価ログ: このレイヤーを通る全呼び出しを1件記録する
  opts.collector?.record({
    role,
    model: cfg.model,
    inTok: out.inTok,
    outTok: out.outTok,
    ...(out.cachedTok ? { cachedTok: out.cachedTok } : {}),
    estCost: estimateCost(cfg, out.inTok, out.outTok, out.cachedTok),
    ms,
    estimated: out.estimated,
    ...rateLimitOf(res),
    ...(fellBack ? { fallback: true } : {}),
  });

  return { ...out, ms };
}

// 応答ヘッダーからプロバイダーの1分あたり上限を読む(OpenAI 形式。無ければ付けない)
export function rateLimitOf(res: Response): { rl?: RateLimitSnapshot } {
  const num = (h: string) => {
    const v = res.headers.get(h);
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const rl: RateLimitSnapshot = {
    limitRequests: num("x-ratelimit-limit-requests"),
    remainingRequests: num("x-ratelimit-remaining-requests"),
    limitTokens: num("x-ratelimit-limit-tokens"),
    remainingTokens: num("x-ratelimit-remaining-tokens"),
  };
  return Object.values(rl).some((v) => v !== undefined) ? { rl } : {};
}

// ---------------------------------------------------------------------------
// APIキー読み出し
// ---------------------------------------------------------------------------
function readKey(env: Env, keyEnv: string): string {
  const key = env[keyEnv];
  if (typeof key !== "string" || key.length === 0) {
    throw new Error(
      `APIキー未設定: 環境変数 ${keyEnv} がありません。.dev.vars もしくは wrangler secret を確認してください`,
    );
  }
  return key;
}

// ---------------------------------------------------------------------------
// provider 別リクエスト構築
// ---------------------------------------------------------------------------
interface BuiltRequest {
  url: string;
  init: RequestInit;
}

function buildRequest(
  cfg: ModelConfig,
  messages: ChatMessage[],
  maxTokens: number,
  apiKey: string,
): BuiltRequest {
  switch (cfg.provider) {
    case "openai-compat":
      return buildOpenAICompat(cfg, messages, maxTokens, apiKey);
    case "gemini":
      return buildGemini(cfg, messages, maxTokens, apiKey);
    case "anthropic":
      return buildAnthropic(cfg, messages, maxTokens, apiKey);
  }
}

function buildOpenAICompat(
  cfg: ModelConfig,
  messages: ChatMessage[],
  maxTokens: number,
  apiKey: string,
): BuiltRequest {
  if (!cfg.baseURL) {
    throw new Error("openai-compat には baseURL が必須です");
  }
  const url = `${trimSlash(cfg.baseURL)}/chat/completions`;
  const body = {
    ...cfg.extraBody,
    model: cfg.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    [cfg.maxTokensParam ?? "max_tokens"]: maxTokens,
  };
  return {
    url,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
  };
}

function buildGemini(
  cfg: ModelConfig,
  messages: ChatMessage[],
  maxTokens: number,
  apiKey: string,
): BuiltRequest {
  const base = cfg.baseURL
    ? trimSlash(cfg.baseURL)
    : "https://generativelanguage.googleapis.com/v1beta";
  // APIキーは URL クエリ (?key=) ではなく x-goog-api-key ヘッダーで渡す。
  // クエリだとアクセスログやプロキシに残りやすいため。
  const url = `${base}/models/${cfg.model}:generateContent`;

  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (systemText.length > 0) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  return {
    url,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    },
  };
}

function buildAnthropic(
  cfg: ModelConfig,
  messages: ChatMessage[],
  maxTokens: number,
  apiKey: string,
): BuiltRequest {
  const base = cfg.baseURL ? trimSlash(cfg.baseURL) : "https://api.anthropic.com";
  const url = `${base}/v1/messages`;

  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const convo = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: maxTokens,
    messages: convo,
  };
  if (systemText.length > 0) body.system = systemText;

  return {
    url,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    },
  };
}

// ---------------------------------------------------------------------------
// provider 別レスポンス抽出。usage が取れなければ 文字数/4 で概算。
// ---------------------------------------------------------------------------
function extractResult(
  cfg: ModelConfig,
  parsed: unknown,
  messages: ChatMessage[],
): Omit<ModelCallResult, "ms"> {
  const p = (parsed ?? {}) as Record<string, unknown>;
  const inCharsFallback = estimateTokens(
    messages.map((m) => m.content).join(""),
  );

  switch (cfg.provider) {
    case "openai-compat": {
      const choices = asArray(p.choices);
      const first = (choices[0] ?? {}) as Record<string, unknown>;
      const message = (first.message ?? {}) as Record<string, unknown>;
      const text = asString(message.content);
      const usage = (p.usage ?? {}) as Record<string, unknown>;
      const inTok = asNumber(usage.prompt_tokens);
      const outTok = asNumber(usage.completion_tokens);
      const truncated = asString(first.finish_reason) === "length";
      return { ...finalize(text, inTok, outTok, inCharsFallback, truncated), ...cachedOf(usage) };
    }
    case "gemini": {
      const candidates = asArray(p.candidates);
      const cand = (candidates[0] ?? {}) as Record<string, unknown>;
      const content = (cand.content ?? {}) as Record<string, unknown>;
      const parts = asArray(content.parts);
      const text = parts
        .map((part) => asString((part as Record<string, unknown>).text))
        .join("");
      const usage = (p.usageMetadata ?? {}) as Record<string, unknown>;
      const inTok = asNumber(usage.promptTokenCount);
      const outTok = asNumber(usage.candidatesTokenCount);
      const truncated = asString(cand.finishReason) === "MAX_TOKENS";
      return finalize(text, inTok, outTok, inCharsFallback, truncated);
    }
    case "anthropic": {
      const blocks = asArray(p.content);
      const text = blocks
        .map((b) => asString((b as Record<string, unknown>).text))
        .join("");
      const usage = (p.usage ?? {}) as Record<string, unknown>;
      const inTok = asNumber(usage.input_tokens);
      const outTok = asNumber(usage.output_tokens);
      const truncated = asString(p.stop_reason) === "max_tokens";
      return finalize(text, inTok, outTok, inCharsFallback, truncated);
    }
  }
}

// OpenAI 互換の usage からキャッシュ済み入力トークン数を取る(無ければ何も足さない)
export function cachedOf(usage: Record<string, unknown>): { cachedTok?: number } {
  const details = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const v = details?.cached_tokens;
  return typeof v === "number" && v > 0 ? { cachedTok: v } : {};
}

function finalize(
  text: string,
  inTok: number | null,
  outTok: number | null,
  inCharsFallback: number,
  truncated: boolean,
): Omit<ModelCallResult, "ms"> {
  if (inTok !== null && outTok !== null) {
    return { text, inTok, outTok, estimated: false, truncated };
  }
  // usage が取れなかった → 文字数/4 で概算
  return {
    text,
    inTok: inTok ?? inCharsFallback,
    outTok: outTok ?? estimateTokens(text),
    estimated: true,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// リトライ付き fetch。429/5xx のみ最大2回、指数バックオフ。AbortSignal を尊重。
// ---------------------------------------------------------------------------
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  retryBaseMs: number,
  noRetryOn429 = false,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    throwIfAborted(signal);
    try {
      const res = await fetch(url, { ...init, signal });
      if (res.status === 429 && noRetryOn429 && attempt >= 1) return res;
      if (isRetryable(res.status) && attempt < MAX_RETRIES) {
        // 混雑時はプロバイダーが示す待ち時間(Retry-After)を尊重する(上限 2 秒。長ければ切り替えに任せる)
        await backoff(retryBaseMs, attempt, signal, retryAfterMs(res));
        continue;
      }
      return res;
    } catch (err) {
      // Abort はリトライせず即座に投げる
      if (isAbortError(err)) throw err;
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await backoff(retryBaseMs, attempt, signal);
        continue;
      }
    }
  }
  throw lastErr ?? new Error("fetch failed");
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

const MAX_RETRY_AFTER_MS = 2000;

function retryAfterMs(res: Response): number {
  const ms = Number(res.headers.get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return Math.min(ms, MAX_RETRY_AFTER_MS);
  const sec = Number(res.headers.get("retry-after"));
  if (Number.isFinite(sec) && sec > 0) return Math.min(sec * 1000, MAX_RETRY_AFTER_MS);
  return 0;
}

async function backoff(
  baseMs: number,
  attempt: number,
  signal: AbortSignal | undefined,
  hintMs = 0,
): Promise<void> {
  const delay = baseMs <= 0 ? 0 : Math.max(baseMs * Math.pow(2, attempt), hintMs);
  if (delay <= 0) {
    throwIfAborted(signal);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delay);
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(abortError());
        return;
      }
      signal.addEventListener("abort", onAbort);
    }
  });
}

// ---------------------------------------------------------------------------
// 小物ユーティリティ
// ---------------------------------------------------------------------------
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Date.now() 相当。テスト環境差異を避けるため一箇所に集約
function nowMs(): number {
  return Date.now();
}
