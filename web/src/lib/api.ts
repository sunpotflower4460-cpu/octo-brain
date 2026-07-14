// バックエンドの SSE エンドポイントを呼び、イベントをハンドラへ振り分けるクライアント。

import { SSEParser } from "./sse";
import { ApiError, humanizeApiError, networkErrorMessage } from "./apiError";
import type {
  AnalyzeRequestBody,
  DeepenRequestBody,
  DeepenResponse,
  DonePayload,
  NodeView,
  ResonateRequestBody,
  ResonateResponse,
  SSEPhase,
} from "../types";

// Capacitor互換: 環境変数は VITE_API_BASE のみ。未設定なら開発既定。
export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

export interface StreamErrorInfo {
  code?: string;
  retryAfterMs?: number;
}

export interface StreamHandlers {
  onPhase?: (phase: SSEPhase, nodeIds?: string[]) => void;
  onNode?: (node: NodeView) => void;
  onToken?: (t: string) => void;
  onDone?: (payload: DonePayload) => void;
  onError?: (message: string, info?: StreamErrorInfo) => void;
}

export async function analyzeStream(
  body: AnalyzeRequestBody,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/analyze/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // ユーザー中断(AbortError)は App 側で判定するため、ここでは接続不能として扱う
    if (err instanceof DOMException && err.name === "AbortError") {
      handlers.onError?.("aborted", { code: "aborted" });
      return;
    }
    handlers.onError?.(networkErrorMessage(), { code: "network" });
    return;
  }

  if (!res.ok || res.body === null) {
    const body = await res.json().catch(() => ({}));
    const h = humanizeApiError(res.status, body);
    handlers.onError?.(h.message, { code: h.code, retryAfterMs: h.retryAfterMs });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SSEParser();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const evt of parser.push(chunk)) dispatch(evt, handlers);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      handlers.onError?.("aborted", { code: "aborted" });
      return;
    }
    handlers.onError?.(networkErrorMessage(), { code: "network" });
  }
}

// 深化 (P1.5 §6): 最緊張軸の対角2腕を再考させ中央脳が織り直した回答を得る。
export async function deepen(
  body: DeepenRequestBody,
  signal?: AbortSignal,
): Promise<DeepenResponse> {
  const res = await postOrThrow(`${API_BASE}/api/deepen`, body, signal);
  return (await res.json()) as DeepenResponse;
}

// 共鳴/掛け算 (P1.6 §4): 一見遠い2意見を掛け合わせ第三の選択肢を得る。
export async function resonate(
  body: ResonateRequestBody,
  signal?: AbortSignal,
): Promise<ResonateResponse> {
  const res = await postOrThrow(`${API_BASE}/api/resonate`, body, signal);
  return (await res.json()) as ResonateResponse;
}

// POST して ok なら Response を返す。非ok は平易化した ApiError、ネットワーク断は
// 平易なメッセージを throw する(生のHTTP本文・スタックは出さない §15.1)。
async function postOrThrow(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new Error(networkErrorMessage());
  }
  if (!res.ok) {
    const parsed = await res.json().catch(() => ({}));
    throw new ApiError(humanizeApiError(res.status, parsed), res.status);
  }
  return res;
}

function dispatch(
  evt: { event: string; data: string },
  handlers: StreamHandlers,
): void {
  const data = safeParse(evt.data);
  switch (evt.event) {
    case "phase": {
      const d = data as { phase: SSEPhase; nodeIds?: string[] };
      handlers.onPhase?.(d.phase, d.nodeIds);
      break;
    }
    case "node":
      handlers.onNode?.(data as NodeView);
      break;
    case "token":
      handlers.onToken?.((data as { t: string }).t);
      break;
    case "done":
      handlers.onDone?.(data as DonePayload);
      break;
    case "error":
      handlers.onError?.((data as { message: string }).message);
      break;
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
