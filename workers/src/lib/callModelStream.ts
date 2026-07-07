// ストリーミング版モデル呼び出し。Synthesizer の token 逐次送出に使う (§9 SSE)。
// provider の streaming API を SSE として読み、テキストデルタを yield する。
// 非ストリーミングの callModel と同じく、終了時に collector へ原価ログを1件記録する。

import {
  MODELS,
  estimateCost,
  type ModelConfig,
  type ModelRole,
} from "../config/models.js";
import type { CallModelOpts } from "./callModel.js";
import type { ChatMessage } from "../types.js";

interface StreamPiece {
  delta?: string;
  inTok?: number;
  outTok?: number;
  done?: boolean;
}

// テキストデルタを逐次 yield する非同期ジェネレータ。
export async function* callModelStream(
  role: ModelRole,
  messages: ChatMessage[],
  opts: CallModelOpts,
): AsyncGenerator<string, void, unknown> {
  const cfg = opts.modelOverride ?? MODELS[role];
  const maxTokens = opts.maxTokens ?? cfg.maxTokens;
  const apiKey = readKey(opts.env, cfg.keyEnv);
  const req = buildStreamRequest(cfg, messages, maxTokens, apiKey);

  const start = nowMs();
  const res = await fetch(req.url, { ...req.init, signal: opts.signal });
  if (!res.ok || res.body === null) {
    const body = res.body ? await res.text() : "";
    throw new Error(
      `callModelStream(${role}) HTTP ${res.status}: ${body.slice(0, 300)}`,
    );
  }

  let acc = "";
  let inTok: number | null = null;
  let outTok: number | null = null;

  for await (const data of readSSE(res.body, opts.signal)) {
    if (data === "[DONE]") break;
    const piece = extractStreamPiece(cfg, data);
    if (piece.inTok != null) inTok = piece.inTok;
    if (piece.outTok != null) outTok = piece.outTok;
    if (piece.delta) {
      acc += piece.delta;
      yield piece.delta;
    }
    if (piece.done) break;
  }

  const ms = nowMs() - start;
  const estimated = inTok === null || outTok === null;
  const finalIn = inTok ?? estimateTokens(messages.map((m) => m.content).join(""));
  const finalOut = outTok ?? estimateTokens(acc);
  opts.collector?.record({
    role,
    model: cfg.model,
    inTok: finalIn,
    outTok: finalOut,
    estCost: estimateCost(cfg, finalIn, finalOut),
    ms,
    estimated,
  });
}

// ---------------------------------------------------------------------------
// provider 別ストリーミングリクエスト構築
// ---------------------------------------------------------------------------
interface BuiltRequest {
  url: string;
  init: RequestInit;
}

function buildStreamRequest(
  cfg: ModelConfig,
  messages: ChatMessage[],
  maxTokens: number,
  apiKey: string,
): BuiltRequest {
  switch (cfg.provider) {
    case "openai-compat": {
      if (!cfg.baseURL) throw new Error("openai-compat には baseURL が必須です");
      return {
        url: `${trimSlash(cfg.baseURL)}/chat/completions`,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            max_tokens: maxTokens,
            stream: true,
            stream_options: { include_usage: true },
          }),
        },
      };
    }
    case "anthropic": {
      const base = cfg.baseURL ? trimSlash(cfg.baseURL) : "https://api.anthropic.com";
      const { system, convo } = splitSystem(messages);
      const body: Record<string, unknown> = {
        model: cfg.model,
        max_tokens: maxTokens,
        messages: convo,
        stream: true,
      };
      if (system) body.system = system;
      return {
        url: `${base}/v1/messages`,
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
    case "gemini": {
      const base = cfg.baseURL
        ? trimSlash(cfg.baseURL)
        : "https://generativelanguage.googleapis.com/v1beta";
      const { system, contents } = splitGemini(messages);
      const body: Record<string, unknown> = {
        contents,
        generationConfig: { maxOutputTokens: maxTokens },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      return {
        // APIキーは x-goog-api-key ヘッダーで渡す (URLクエリに載せない)
        url: `${base}/models/${cfg.model}:streamGenerateContent?alt=sse`,
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
  }
}

// ---------------------------------------------------------------------------
// provider 別デルタ抽出
// ---------------------------------------------------------------------------
function extractStreamPiece(cfg: ModelConfig, data: string): StreamPiece {
  const json = safeJson(data);
  if (json === null) return {};
  const p = json as Record<string, unknown>;

  switch (cfg.provider) {
    case "openai-compat": {
      const choices = asArray(p.choices);
      const first = (choices[0] ?? {}) as Record<string, unknown>;
      const delta = (first.delta ?? {}) as Record<string, unknown>;
      const usage = (p.usage ?? null) as Record<string, unknown> | null;
      return {
        delta: asString(delta.content),
        inTok: usage ? asNumber(usage.prompt_tokens) ?? undefined : undefined,
        outTok: usage ? asNumber(usage.completion_tokens) ?? undefined : undefined,
      };
    }
    case "anthropic": {
      const type = asString(p.type);
      if (type === "content_block_delta") {
        const d = (p.delta ?? {}) as Record<string, unknown>;
        return { delta: asString(d.text) };
      }
      if (type === "message_start") {
        const msg = (p.message ?? {}) as Record<string, unknown>;
        const usage = (msg.usage ?? {}) as Record<string, unknown>;
        return { inTok: asNumber(usage.input_tokens) ?? undefined };
      }
      if (type === "message_delta") {
        const usage = (p.usage ?? {}) as Record<string, unknown>;
        return { outTok: asNumber(usage.output_tokens) ?? undefined };
      }
      if (type === "message_stop") return { done: true };
      return {};
    }
    case "gemini": {
      const candidates = asArray(p.candidates);
      const cand = (candidates[0] ?? {}) as Record<string, unknown>;
      const content = (cand.content ?? {}) as Record<string, unknown>;
      const parts = asArray(content.parts);
      const text = parts
        .map((part) => asString((part as Record<string, unknown>).text))
        .join("");
      const usage = (p.usageMetadata ?? null) as Record<string, unknown> | null;
      return {
        delta: text,
        inTok: usage ? asNumber(usage.promptTokenCount) ?? undefined : undefined,
        outTok: usage ? asNumber(usage.candidatesTokenCount) ?? undefined : undefined,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// SSE 読み取り: ReadableStream を行分割し、data: 部分を1メッセージずつ yield
// ---------------------------------------------------------------------------
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (signal?.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSEメッセージは空行 (\n\n) 区切り
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = parseSSEData(rawEvent);
        if (data !== null) yield data;
        sep = buffer.indexOf("\n\n");
      }
    }
    const tail = parseSSEData(buffer);
    if (tail !== null) yield tail;
  } finally {
    reader.releaseLock();
  }
}

// 1つのSSEイベントブロックから data: 行を結合して返す。data が無ければ null。
function parseSSEData(block: string): string | null {
  const dataLines = block
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).replace(/^ /, ""));
  if (dataLines.length === 0) return null;
  return dataLines.join("\n");
}

// ---------------------------------------------------------------------------
// 小物 (callModel.ts と同等のものをローカルに)
// ---------------------------------------------------------------------------
function readKey(env: Record<string, unknown>, keyEnv: string): string {
  const key = env[keyEnv];
  if (typeof key !== "string" || key.length === 0) {
    throw new Error(
      `APIキー未設定: 環境変数 ${keyEnv} がありません。.dev.vars もしくは wrangler secret を確認してください`,
    );
  }
  return key;
}

function splitSystem(messages: ChatMessage[]): {
  system: string;
  convo: { role: string; content: string }[];
} {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const convo = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));
  return { system, convo };
}

function splitGemini(messages: ChatMessage[]): {
  system: string;
  contents: { role: string; parts: { text: string }[] }[];
} {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  return { system, contents };
}

function abortError(): Error {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
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
    return null;
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

function nowMs(): number {
  return Date.now();
}
