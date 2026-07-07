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
  MODELS,
  type ModelConfig,
  type ModelRole,
} from "../config/models.js";
import type { ChatMessage, Env, ModelCallResult } from "../types.js";

export interface CallModelOpts {
  env: Env;
  maxTokens?: number;
  signal?: AbortSignal;
  modelOverride?: ModelConfig;
  // リトライのベース待機ms (指数バックオフ)。テストで 0 を渡せるよう外出し
  retryBaseMs?: number;
}

const MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 250;

export async function callModel(
  role: ModelRole,
  messages: ChatMessage[],
  opts: CallModelOpts,
): Promise<ModelCallResult> {
  const cfg = opts.modelOverride ?? MODELS[role];
  const maxTokens = opts.maxTokens ?? cfg.maxTokens;
  const apiKey = readKey(opts.env, cfg.keyEnv);

  const req = buildRequest(cfg, messages, maxTokens, apiKey);

  const start = nowMs();
  const res = await fetchWithRetry(
    req.url,
    req.init,
    opts.signal,
    opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
  );
  const bodyText = await res.text();
  const ms = nowMs() - start;

  if (!res.ok) {
    throw new Error(
      `callModel(${role}) HTTP ${res.status}: ${bodyText.slice(0, 300)}`,
    );
  }

  const parsed = safeJson(bodyText);
  const out = extractResult(cfg, parsed, messages);
  return { ...out, ms };
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
    model: cfg.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: maxTokens,
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
  const url = `${base}/models/${cfg.model}:generateContent?key=${encodeURIComponent(apiKey)}`;

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
      headers: { "content-type": "application/json" },
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
      return finalize(text, inTok, outTok, inCharsFallback);
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
      return finalize(text, inTok, outTok, inCharsFallback);
    }
    case "anthropic": {
      const blocks = asArray(p.content);
      const text = blocks
        .map((b) => asString((b as Record<string, unknown>).text))
        .join("");
      const usage = (p.usage ?? {}) as Record<string, unknown>;
      const inTok = asNumber(usage.input_tokens);
      const outTok = asNumber(usage.output_tokens);
      return finalize(text, inTok, outTok, inCharsFallback);
    }
  }
}

function finalize(
  text: string,
  inTok: number | null,
  outTok: number | null,
  inCharsFallback: number,
): Omit<ModelCallResult, "ms"> {
  if (inTok !== null && outTok !== null) {
    return { text, inTok, outTok, estimated: false };
  }
  // usage が取れなかった → 文字数/4 で概算
  return {
    text,
    inTok: inTok ?? inCharsFallback,
    outTok: outTok ?? estimateTokens(text),
    estimated: true,
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
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    throwIfAborted(signal);
    try {
      const res = await fetch(url, { ...init, signal });
      if (isRetryable(res.status) && attempt < MAX_RETRIES) {
        await backoff(retryBaseMs, attempt, signal);
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

async function backoff(
  baseMs: number,
  attempt: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  const delay = baseMs * Math.pow(2, attempt);
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
