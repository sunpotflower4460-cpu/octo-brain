// バックエンドの SSE エンドポイントを呼び、イベントをハンドラへ振り分けるクライアント。

import { SSEParser } from "./sse";
import type {
  AnalyzeRequestBody,
  DonePayload,
  NodeView,
  SSEPhase,
} from "../types";

// Capacitor互換: 環境変数は VITE_API_BASE のみ。未設定なら開発既定。
export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

export interface StreamHandlers {
  onPhase?: (phase: SSEPhase) => void;
  onNode?: (node: NodeView) => void;
  onToken?: (t: string) => void;
  onDone?: (payload: DonePayload) => void;
  onError?: (message: string) => void;
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
    handlers.onError?.(err instanceof Error ? err.message : String(err));
    return;
  }

  if (!res.ok || res.body === null) {
    const text = await res.text().catch(() => "");
    handlers.onError?.(`HTTP ${res.status}: ${text.slice(0, 300)}`);
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
    handlers.onError?.(err instanceof Error ? err.message : String(err));
  }
}

function dispatch(
  evt: { event: string; data: string },
  handlers: StreamHandlers,
): void {
  const data = safeParse(evt.data);
  switch (evt.event) {
    case "phase":
      handlers.onPhase?.((data as { phase: SSEPhase }).phase);
      break;
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
