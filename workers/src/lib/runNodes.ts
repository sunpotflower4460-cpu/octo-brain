// 並列ノード実行 (docs/00_architecture.md §2, §3)。
// 起動ノードを Promise.allSettled で並列実行し、各ノードに8秒タイムアウト。
// JSONパース失敗は parse_error として棄却 (リトライしない)。クォーラム判定を行う。

import { callModel } from "./callModel.js";
import {
  QUORUM,
  ROUTE_NODES,
  nodeDef,
  nodeSystemPrompt,
  type NodeId,
} from "../config/nodes.js";
import { pickNodeModel } from "../config/models.js";
import type {
  CostSink,
  Env,
  NodeFlag,
  NodeResult,
  Route,
} from "../types.js";

const NODE_TIMEOUT_MS = 8000;
const MAX_POINTS = 3;
const MAX_POINT_LEN = 60;

export interface RunNodesOpts {
  env: Env;
  collector?: CostSink;
  signal?: AbortSignal;
  // テスト用。既定は8秒。
  nodeTimeoutMs?: number;
}

export interface RunNodesResult {
  nodes: NodeResult[];
  successCount: number;
  required: number;
  // クォーラム未達なら true (§3: 統合をスキップして単発フォールバック)
  fallback: boolean;
}

export async function runNodes(
  route: Route,
  input: string,
  summary: string,
  opts: RunNodesOpts,
): Promise<RunNodesResult> {
  const ids = ROUTE_NODES[route];
  const required = QUORUM[route];
  const timeoutMs = opts.nodeTimeoutMs ?? NODE_TIMEOUT_MS;
  const userText = buildNodeUserText(input, summary);

  const settled = await Promise.allSettled(
    ids.map((id, i) => runOne(id, i, userText, timeoutMs, opts)),
  );

  // runOne は内部で例外を握って NodeResult を返すので基本 fulfilled。
  // 念のため rejected は error 扱いにする。
  const nodes: NodeResult[] = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : { id: ids[i], status: "error", points: [], confidence: 0, flag: null },
  );

  const successCount = nodes.filter((n) => n.status === "ok").length;
  return { nodes, successCount, required, fallback: successCount < required };
}

async function runOne(
  id: NodeId,
  index: number,
  userText: string,
  timeoutMs: number,
  opts: RunNodesOpts,
): Promise<NodeResult> {
  const def = nodeDef(id);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onExternalAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onExternalAbort);

  try {
    const res = await callModel(
      "node",
      [
        { role: "system", content: nodeSystemPrompt(def) },
        { role: "user", content: userText },
      ],
      {
        env: opts.env,
        signal: ctrl.signal,
        collector: opts.collector,
        modelOverride: pickNodeModel(index),
      },
    );
    return parseNodeResponse(id, res.text);
  } catch {
    // タイムアウト由来の中断は timeout、それ以外は error
    const status = ctrl.signal.aborted ? "timeout" : "error";
    return { id, status, points: [], confidence: 0, flag: null };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }
}

// ノードに渡す user メッセージ。ローリング要約(あれば)+今回の入力のみ (§6)。
export function buildNodeUserText(input: string, summary: string): string {
  const parts: string[] = [];
  if (summary.trim().length > 0) {
    parts.push(`[会話要約]\n${summary.trim()}`);
  }
  parts.push(`[入力]\n${input}`);
  return parts.join("\n\n");
}

// 生パース → 失敗なら {...} 抽出を1回 → 失敗なら parse_error (§2)。
export function parseNodeResponse(id: NodeId, raw: string): NodeResult {
  const obj = tryParseObject(raw);
  if (obj === null) {
    return { id, status: "parse_error", points: [], confidence: 0, flag: null };
  }
  return {
    id,
    status: "ok",
    points: normalizePoints(obj.points),
    confidence: clamp01(obj.confidence),
    flag: normalizeFlag(obj.flag),
  };
}

function tryParseObject(raw: string): Record<string, unknown> | null {
  const direct = parseJsonObject(raw);
  if (direct) return direct;
  // 応答文字列から最初の { ... 最後の } を1回だけ抽出して再試行
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return parseJsonObject(raw.slice(start, end + 1));
  }
  return null;
}

function parseJsonObject(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v !== null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// points: 文字列のみ・各60字に切り詰め・最大3つ (§2)。
function normalizePoints(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .slice(0, MAX_POINTS)
    .map((p) => (p.length > MAX_POINT_LEN ? p.slice(0, MAX_POINT_LEN) : p));
}

function clamp01(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function normalizeFlag(v: unknown): NodeFlag {
  return v === "insufficient_input" || v === "off_topic" ? v : null;
}
